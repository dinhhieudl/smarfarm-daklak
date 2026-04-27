/*
 * Copyright (c) 2006-2018, RT-Thread Development Team
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Change Logs:
 * Date           Author          Notes
 * 2020-04-08     Sunwancn        first version
 */

#include <rtthread.h>

#if defined(RT_USING_PM)

#include <drv_pmhw.h>

/* ------------------ PM oscillator start ------------------ */
/* STM32F2 */
#define OSC_CONF_SYS_FREQ_MAX       120U    /* Max system clock  MHz */
#define OSC_CONF_PLL_SYS_FREQ_MIN   24U     /* Min system clock with pll on  MHz */
#define OSC_CONF_PCLK1_FREQ_MAX     30U     /* Max PCLK1  MHz */
#define OSC_CONF_PCLK2_FREQ_MAX     60U     /* Max PCLK1  MHz */
#define OSC_CONF_PLLM_MIN           2U      /* Min pllm divider */
#define OSC_CONF_PLLM_MAX           63U     /* Max pllm divider */
#define OSC_CONF_PLLN_MIN           192U    /* Min plln multiplier */
#define OSC_CONF_PLLN_MAX           432U    /* Max plln multiplier */
#define OSC_CONF_PLLQ_MIN           2U      /* Min pllq divider */
#define OSC_CONF_PLLQ_MAX           15U     /* Max pllq divider */

#if defined(RT_PM_USING_VDD_2P7_3P6)
  #define FLASH_LATENCY_MAX_NUMS    5U
  #define FLASH_LATENCY_FREQ        30U     /* FLASH_LATENCY increasing frequency  MHz */
#elif defined(RT_PM_USING_VDD_2P4_2P7)
  #define FLASH_LATENCY_MAX_NUMS    6U
  #define FLASH_LATENCY_FREQ        24U     /* FLASH_LATENCY increasing frequency  MHz */
#elif defined(RT_PM_USING_VDD_2P1_2P4)
  #define FLASH_LATENCY_MAX_NUMS    7U
  #define FLASH_LATENCY_FREQ        18U     /* FLASH_LATENCY increasing frequency  MHz */
#else
  #define FLASH_LATENCY_MAX_NUMS    8U
  #define FLASH_LATENCY_FREQ        16U     /* FLASH_LATENCY increasing frequency  MHz */
#endif

struct rcc_conf_struct
{
    rt_uint32_t mode;
    rt_uint32_t sysclk_source;
    rt_uint32_t pll_state;
    rt_uint32_t pllm;
    rt_uint32_t plln;
    rt_uint32_t pllp;
    rt_uint32_t pllq;
    rt_uint32_t ahb_div;
    rt_uint32_t apb1_div;
    rt_uint32_t apb2_div;
    rt_uint32_t latency;
};
static struct rcc_conf_struct _rcc_conf[PM_RUN_MODE_MAX] = {0};

static struct osc_conf_struct
{
    rt_uint32_t init;
    rt_uint32_t osc_type;
    rt_uint32_t osc_freq;
}
_osc_conf = {0};

static void (* _set_sysclock[PM_RUN_MODE_MAX])(void) = {0};

RT_WEAK rt_uint16_t stm32_run_freq[PM_RUN_MODE_MAX][2] =
{
    /* The actual frequency is 1/divisor MHz, divisor = {1, 1000} */
    /* {sysclk frequency, divisor} */
    {120, 1},    /* High speed */
    {120, 1},    /* Normal speed */
    {24,  1},    /* Medium speed */
    {2,   1},    /* Low speed, this is HCLK */
};

#if defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE)
/* Get the greatest common divisor by Stein algorithm */
static rt_uint32_t get_stein_div(rt_uint32_t x, rt_uint32_t y)
{
    rt_uint32_t tmp, cnt = 0;

    RT_ASSERT(x > 0 && y > 0);

    /* bigger --> x, smaller --> y */
    if (x < y)
    {
        tmp = x;
        x = y;
        y = tmp;
    }

    while (x != y)
    {
        if (x & 1U)
        {
            if (y & 1U)
            {
                y = (x - y) >> 1U;
                x -= y;
            }
            else
            {
                y >>= 1U;
            }
        }
        else
        {
            if (y & 1U)
            {
                x >>= 1U;
                if (x < y)
                {
                    tmp = x;
                    x = y;
                    y = tmp;
                }
            }
            else
            {
                x >>= 1U;
                y >>= 1U;
                ++cnt;
            }
        }
    }
    return (x << cnt);
}
#endif

/**
 * This function configure clock tree
 *
 * @return SYSCLK or HCLK frequency (MHz)
 */
static rt_uint16_t clock_tree_config(struct rcc_conf_struct *conf, rt_uint32_t freq_base, rt_uint32_t freq_hclk)
{
    rt_uint32_t freq, div, mul, freq_div, i = 1U;

    freq_div = stm32_run_freq[conf->mode][1];

    RT_ASSERT(conf != RT_NULL && freq_hclk > 0);
    RT_ASSERT(freq_div == 1U || freq_div == 1000U);
    RT_ASSERT(freq_base >= OSC_CONF_PLLM_MIN && freq_base <= OSC_CONF_PLLM_MAX);

    freq_base = freq_base / 1000U * freq_div;

    if (freq_div == 1 && conf->pll_state == RCC_PLL_ON && freq_hclk >= OSC_CONF_PLL_SYS_FREQ_MIN)
    {
        /* Use PLL clock */
        conf->sysclk_source = RCC_SYSCLKSOURCE_PLLCLK;
        /* Set PLLM input frequency 1MHz */
        conf->pllm = freq_base;

        /* Get the PLLN multiplier */
#if defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE)
        mul = (freq_hclk << 1U) * 48U / get_stein_div((freq_hclk << 1U), 48U);
        while (mul * i < OSC_CONF_PLLN_MIN || mul * i / 48U < OSC_CONF_PLLQ_MIN)
#else
        mul = freq_hclk << 1U;
        while (mul * i < OSC_CONF_PLLN_MIN)
#endif
            i++;
        mul *= i;
        if (mul > OSC_CONF_PLLN_MAX)
        {
            /* Does not meet the optimal frequency */
            /* PLLP = [2, 4, 6, 8] */
            for (div = 2U; div <= 8U; div += 2U)
            {
                mul = freq_hclk * div;
                if ((mul > OSC_CONF_PLLN_MAX) || (div == 8U && mul < OSC_CONF_PLLN_MIN))
                {
                    rt_kprintf("error: Incorrect system frequency settings.\n");
                    RT_ASSERT(0);
                }
                else if (mul >= OSC_CONF_PLLN_MIN)
                {
                    break;
                }
            }
        }
        else
        {
            /* PLLP = [2, 4, 6, 8] */
            div = (mul / freq_hclk) & 0xfe;
        }

        if (div > 8U) div = 8U;

        conf->plln = mul;
        conf->pllp = div;
        freq = mul / div;

        div = mul / 48U;
        if (mul % 48U > 0) div++;

        conf->pllq = div;
        conf->ahb_div = RCC_SYSCLK_DIV1;
    }
    else
    {
        conf->pll_state = RCC_PLL_OFF;

        /* Select HSI for SYSCLK source */
        freq_base = HSI_VALUE / 1000000U * freq_div;
        conf->sysclk_source = RCC_SYSCLKSOURCE_HSI;

        /* Get AHB divider */
        for (div = 0U; div <= 8U; div++)
        {
            if (div == 8U || (freq_base >> div) <= freq_hclk)
                break;
        }
        freq = freq_base >> div;
        if (div) div += 7U;
        conf->ahb_div = (div << RCC_CFGR_HPRE_Pos) & RCC_CFGR_HPRE;
    }

    /* Get APB1 divider */
    for (div = 0U; div <= 4U; div++)
    {
        if (div == 4U || (freq >> div) <= OSC_CONF_PCLK1_FREQ_MAX)
            break;
    }
    if (div) div += 3U;
    conf->apb1_div = (div << RCC_CFGR_PPRE1_Pos) & RCC_CFGR_PPRE1;

    /* Get APB2 divider */
    for (div = 0U; div <= 4U; div++)
    {
        if (div == 4U || (freq >> div) <= OSC_CONF_PCLK2_FREQ_MAX)
            break;
    }
    if (div) div += 3U;
    conf->apb2_div = (div << RCC_CFGR_PPRE2_Pos) & RCC_CFGR_PPRE2;

    (void)div;
    (void)mul;

    /* Find flash access latency */
    conf->latency = ((rt_uint32_t)(FLASH_LATENCY_MAX_NUMS - 1U) << FLASH_ACR_LATENCY_Pos) & FLASH_ACR_LATENCY;
    for (i = 1; i <= FLASH_LATENCY_MAX_NUMS; i++)
    {
        if ((freq / freq_div) <= FLASH_LATENCY_FREQ * i)
        {
            conf->latency = ((i - 1U) << FLASH_ACR_LATENCY_Pos) & FLASH_ACR_LATENCY;
            break;
        }
    }

    return (rt_uint16_t)freq;
}

static int rcc_conf_init(void)
{
    rt_uint32_t mode = PM_RUN_MODE_NORMAL_SPEED;
    struct rcc_conf_struct *conf = &_rcc_conf[mode];
    struct osc_conf_struct *osc = &_osc_conf;

    if (!osc->init)
    {
        switch (RCC->CFGR & RCC_CFGR_SWS)
        {
        case RCC_CFGR_SWS_HSE:  /* HSE used as system clock */
            conf->pll_state = RCC_PLL_OFF;
            conf->sysclk_source = RCC_SYSCLKSOURCE_HSE;
            osc->osc_type = RCC_OSCILLATORTYPE_HSE;
            osc->osc_freq = HSE_VALUE / 1000U;
            break;
        case RCC_CFGR_SWS_PLL:  /* PLL used as system clock */
            conf->pll_state = RCC_PLL_ON;
            conf->sysclk_source = RCC_SYSCLKSOURCE_PLLCLK;

            if(__HAL_RCC_GET_PLL_OSCSOURCE() == RCC_PLLSOURCE_HSE)
            {
                osc->osc_type = RCC_OSCILLATORTYPE_HSE;
                osc->osc_freq = HSE_VALUE / 1000U;
            }
            else
            {
                osc->osc_type = RCC_OSCILLATORTYPE_HSI;
                osc->osc_freq = HSI_VALUE / 1000U;
            }
            break;
        case RCC_CFGR_SWS_HSI:  /* HSI used as system clock source */
        default:  /* HSI used as system clock */
            conf->pll_state = RCC_PLL_OFF;
            conf->sysclk_source = RCC_SYSCLKSOURCE_HSI;
            osc->osc_type = RCC_OSCILLATORTYPE_HSI;
            osc->osc_freq = HSI_VALUE / 1000U;
            break;
        }

        /* Get the normal run speed register settings */
        if (conf->pll_state == RCC_PLL_ON)
        {
            conf->pllm = (RCC->PLLCFGR & RCC_PLLCFGR_PLLM) >> RCC_PLLCFGR_PLLM_Pos;
            conf->plln = (RCC->PLLCFGR & RCC_PLLCFGR_PLLN) >> RCC_PLLCFGR_PLLN_Pos;
            conf->pllp = (((RCC->PLLCFGR & RCC_PLLCFGR_PLLP) >> RCC_PLLCFGR_PLLP_Pos) + 1U) << 1U;
            conf->pllq = (RCC->PLLCFGR & RCC_PLLCFGR_PLLQ) >> RCC_PLLCFGR_PLLQ_Pos;
        }
        conf->ahb_div = RCC->CFGR & RCC_CFGR_HPRE;
        conf->apb1_div = RCC->CFGR & RCC_CFGR_PPRE1;
        conf->apb2_div = RCC->CFGR & RCC_CFGR_PPRE2;
        conf->latency = FLASH->ACR & FLASH_ACR_LATENCY;
        stm32_run_freq[mode][0] = HAL_RCC_GetSysClockFreq() / 1000000U;

        /* Initialize the _rcc_conf[] arrays */
        for (mode = PM_RUN_MODE_HIGH_SPEED; mode < PM_RUN_MODE_MAX; mode++)
        {
            conf = &_rcc_conf[mode];
            conf->mode = mode;

            switch (mode)
            {
            case PM_RUN_MODE_HIGH_SPEED:
                _set_sysclock[mode] = stm32_systemclock_high;
                if (stm32_run_freq[mode][0] > stm32_run_freq[PM_RUN_MODE_NORMAL_SPEED][0])
                {
                    conf->pll_state = RCC_PLL_ON;
                    stm32_run_freq[mode][0] = clock_tree_config(conf, osc->osc_freq, stm32_run_freq[mode][0]);
                }
                else
                {
                    rt_memcpy(conf, &_rcc_conf[PM_RUN_MODE_NORMAL_SPEED], sizeof(struct rcc_conf_struct));
                    stm32_run_freq[mode][0] = stm32_run_freq[PM_RUN_MODE_NORMAL_SPEED][0];
                }
                break;
            case PM_RUN_MODE_NORMAL_SPEED:
                _set_sysclock[mode] = stm32_systemclock_normal;
                break;
            case PM_RUN_MODE_MEDIUM_SPEED:
                _set_sysclock[mode] = stm32_systemclock_medium;
                conf->pll_state = RCC_PLL_ON;
                stm32_run_freq[mode][0] = clock_tree_config(conf, osc->osc_freq, stm32_run_freq[mode][0]);
                break;
            case PM_RUN_MODE_LOW_SPEED:
                _set_sysclock[mode] = stm32_systemclock_low;
                conf->pll_state = RCC_PLL_OFF;
                stm32_run_freq[mode][0] = clock_tree_config(conf, osc->osc_freq, stm32_run_freq[mode][0]);
                break;
            default:
                RT_ASSERT(0);
                break;
            }
        }

        osc->init = 1U;
    }

    return 0;
}
INIT_DEVICE_EXPORT(rcc_conf_init);

/* System Clock Configuration */
static void systemclock_run(struct rcc_conf_struct *conf)
{
    RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};
    RCC_OscInitTypeDef RCC_OscInitStruct = {0};

    if ((conf->pll_state == RCC_PLL_ON && _osc_conf.osc_type == RCC_OSCILLATORTYPE_HSE)
            || conf->sysclk_source == RCC_SYSCLKSOURCE_HSE)
    {
        RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
        RCC_OscInitStruct.HSEState = RCC_HSE_ON;
        RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
    }
    else
    {
        RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
        RCC_OscInitStruct.HSIState = RCC_HSI_ON;
        RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
        RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSI;
    }

    RCC_OscInitStruct.PLL.PLLState = conf->pll_state;
    if (conf->pll_state == RCC_PLL_ON)
    {
        RCC_OscInitStruct.PLL.PLLM = conf->pllm;
        RCC_OscInitStruct.PLL.PLLN = conf->plln;
        RCC_OscInitStruct.PLL.PLLP = conf->pllp;
        RCC_OscInitStruct.PLL.PLLQ = conf->pllq;
    }

    if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
    {
        Error_Handler();
    }

    /* Reconfigure the SYSCLK HCLK PCLK1 PCLK2 */
    RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_HCLK | \
                                  RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    RCC_ClkInitStruct.SYSCLKSource = conf->sysclk_source;
    RCC_ClkInitStruct.AHBCLKDivider = conf->ahb_div;
    RCC_ClkInitStruct.APB1CLKDivider = conf->apb1_div;
    RCC_ClkInitStruct.APB2CLKDivider = conf->apb2_div;
    if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, conf->latency) != HAL_OK)
    {
        Error_Handler();
    }
}

static void systemclock_msi_on(rt_uint32_t mode)
{
    RCC_OscInitTypeDef RCC_OscInitStruct   = {0};
    RCC_ClkInitTypeDef RCC_ClkInitStruct   = {0};

    (void)mode;

    if ((__HAL_RCC_GET_SYSCLK_SOURCE() != RCC_SYSCLKSOURCE_STATUS_HSI)
            || (__HAL_RCC_GET_SYSCLK_SOURCE() == RCC_SYSCLKSOURCE_STATUS_PLLCLK
                && _osc_conf.osc_type != RCC_OSCILLATORTYPE_HSI))
    {
        RCC_OscInitStruct.OscillatorType    = RCC_OSCILLATORTYPE_HSI;
        RCC_OscInitStruct.HSIState          = RCC_HSI_ON;
        RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
        RCC_OscInitStruct.PLL.PLLState      = RCC_PLL_NONE;  /* No update on PLL */
        if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
        {
            Error_Handler();
        }
    }

    RCC_ClkInitStruct.ClockType         = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK;
    RCC_ClkInitStruct.SYSCLKSource      = RCC_SYSCLKSOURCE_HSI;
    RCC_ClkInitStruct.AHBCLKDivider     = RCC_SYSCLK_DIV1;
    if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_0) != HAL_OK)
    {
        Error_Handler();
    }
}

static void systemclock_msi_off(rt_uint32_t mode)
{
    if (_osc_conf.osc_type != RCC_OSCILLATORTYPE_HSI && _rcc_conf[mode].sysclk_source != RCC_SYSCLKSOURCE_HSI)
        __HAL_RCC_HSI_DISABLE();
}

/**
  * @brief  Configures system clock after wake-up from STOP: enable MSI or HSI, PLL
  *         and select PLL as system clock source.
  * @param  None
  * @retval None
  */
static void systemclock_reconfig(rt_uint32_t mode)
{
    systemclock_msi_on(mode);

    _set_sysclock[mode]();
}

/* System Clock Configuration On High Speed */
RT_WEAK void stm32_systemclock_high(void)
{
    systemclock_run(&_rcc_conf[PM_RUN_MODE_HIGH_SPEED]);
}

/* System Clock Configuration On Normal Speed */
RT_WEAK void stm32_systemclock_normal(void)
{
    systemclock_run(&_rcc_conf[PM_RUN_MODE_NORMAL_SPEED]);
}

/* System Clock Configuration On Medium Speed */
RT_WEAK void stm32_systemclock_medium(void)
{
    systemclock_run(&_rcc_conf[PM_RUN_MODE_MEDIUM_SPEED]);
}

/* System Clock Configuration On Low Speed */
RT_WEAK void stm32_systemclock_low(void)
{
    systemclock_run(&_rcc_conf[PM_RUN_MODE_LOW_SPEED]);
}

/* --------------------- PM oscillator end --------------------- */

#if defined(RT_USING_SERIAL)
static void uart_console_reconfig(void)
{
    struct serial_configure config = RT_SERIAL_CONFIG_DEFAULT;

    rt_device_control(rt_console_get_device(), RT_DEVICE_CTRL_CONFIG, &config);
}
#endif

/**
 * This function will put STM32 into sleep mode.
 *
 * @param pm pointer to power manage structure
 */
void stm32_sleep(struct rt_pm *pm, rt_uint8_t mode)
{
    switch (mode)
    {
    case PM_SLEEP_MODE_NONE:
        break;

    case PM_SLEEP_MODE_IDLE:
    case PM_SLEEP_MODE_LIGHT:
        HAL_PWR_EnterSLEEPMode(PWR_MAINREGULATOR_ON, PWR_SLEEPENTRY_WFI);
        break;

    case PM_SLEEP_MODE_DEEP:
        /* Disable SysTick interrupt */
        CLEAR_BIT(SysTick->CTRL, (rt_uint32_t)SysTick_CTRL_TICKINT_Msk);
        /* Enables the Flash Power Down in Stop mode */
        SET_BIT(PWR->CR, (rt_uint32_t)PWR_CR_FPDS);
        /* Enter STOP mode  */
        HAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON, PWR_STOPENTRY_WFI);
        /* Disables the Flash Power Down in Stop mode */
        CLEAR_BIT(PWR->CR, (rt_uint32_t)PWR_CR_FPDS);
        /* Enable SysTick interrupt */
        SET_BIT(SysTick->CTRL, (rt_uint32_t)SysTick_CTRL_TICKINT_Msk);
        /* Re-configure the system clock */
        systemclock_reconfig(pm->run_mode);
        break;

    case PM_SLEEP_MODE_STANDBY:
    case PM_SLEEP_MODE_SHUTDOWN:
        __HAL_PWR_CLEAR_FLAG(PWR_FLAG_WU);
        /* Enter STANDBY mode */
        HAL_PWR_EnterSTANDBYMode();
        break;

    default:
        RT_ASSERT(0);
        break;
    }
}

void stm32_run(struct rt_pm *pm, rt_uint8_t mode)
{
    static rt_uint32_t last_mode;
    static char *run_str[] = PM_RUN_MODE_NAMES;

    if (mode == last_mode)
        return;

    if (stm32_run_freq[mode][0] != stm32_run_freq[last_mode][0])
    {
        systemclock_msi_on(last_mode);

        _set_sysclock[mode]();

        systemclock_msi_off(mode);

#if defined(RT_USING_SERIAL)
        /* Re-Configure the UARTs */
        uart_console_reconfig();
#endif
        /* Re-Configure the Systick time */
        HAL_SYSTICK_Config(HAL_RCC_GetHCLKFreq() / RT_TICK_PER_SECOND);
        /* Re-Configure the Systick */
        HAL_SYSTICK_CLKSourceConfig(SYSTICK_CLKSOURCE_HCLK);
    }

    last_mode = mode;
    rt_kprintf("switch to %s mode, frequency = %d %sHz\n",
               run_str[mode], stm32_run_freq[mode][0], (stm32_run_freq[mode][1] == 1) ? "M" : "K");

    if ((stm32_run_freq[mode][0] / stm32_run_freq[mode][1]) > OSC_CONF_SYS_FREQ_MAX)
        rt_kprintf("warning: The frequency has over than %d MHz\n", OSC_CONF_SYS_FREQ_MAX);
}

#endif /* defined(RT_USING_PM) */
