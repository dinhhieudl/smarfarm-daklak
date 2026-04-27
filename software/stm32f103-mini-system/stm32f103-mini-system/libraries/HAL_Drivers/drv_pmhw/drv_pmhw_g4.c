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
/* STM32G4 */
#define OSC_CONF_SYS_FREQ_MAX       170U    /* Max system clock  MHz */
#define OSC_CONF_SYS_FREQ_NORMAL    144U    /* Normal system clock  MHz */
#define FLASH_LATENCY_MAX_NUMS      9U
#define PM_POW_VOLT_SCALE_NUMS      3U

#define OSC_CONF_PLLM_FREQ_MIN      3U      /* Min pllm clock  MHz */
#define OSC_CONF_PLLM_FREQ_MAX      8U      /* Max pllm clock  MHz */
#define OSC_CONF_PLL_VCO_FREQ_MIN   64U     /* Min pll vco clock  MHz */
#define OSC_CONF_PLL_VCO_FREQ_MAX   344U    /* Max pll vco clock  MHz */
#define OSC_CONF_PLLM_DIV_MIN       1U      /* Min pllm divider */
#define OSC_CONF_PLLM_DIV_MAX       16U     /* Max pllm divider */
#define OSC_CONF_PLLN_MUL_MIN       8U      /* Min plln multiplier */
#define OSC_CONF_PLLN_MUL_MAX       127U    /* Max plln multiplier */
#define OSC_CONF_PLLR_DIV_MIN       2U      /* Min pllr divider */
#define OSC_CONF_PLLR_DIV_MAX       8U      /* Max pllr divider */
#define OSC_CONF_PLLQ_DIV_MIN       2U      /* Min pllq divider */
#define OSC_CONF_PLLQ_DIV_MAX       8U      /* Max pllq divider */

#define OSC_CONF_LOW_POW_RUN_FREQ   2U      /* Low-power Run mode frequency  MHz */

struct rcc_conf_struct
{
    rt_uint32_t mode;
    rt_uint32_t sysclk_source;
    rt_uint32_t clk48_source;
    rt_uint32_t pll_state;
    rt_uint32_t pllm;
    rt_uint32_t plln;
    rt_uint32_t pllr;
    rt_uint32_t pllp;
    rt_uint32_t pllq;
    rt_uint32_t ahb_div;
    rt_uint32_t latency;
    rt_uint32_t volt_scale;
    rt_bool_t low_pow_run_en;
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
static const rt_uint32_t _volt_scale_tab[PM_POW_VOLT_SCALE_NUMS][3] =
{
    /* voltage range, frequency step for flash latency, HCLK */
    {PWR_REGULATOR_VOLTAGE_SCALE2,       13U,  26U},
    {PWR_REGULATOR_VOLTAGE_SCALE1,       30U, 150U},
    {PWR_REGULATOR_VOLTAGE_SCALE1_BOOST, 34U, 170U},
};

RT_WEAK rt_uint16_t stm32_run_freq[PM_RUN_MODE_MAX][2] =
{
    /* The actual frequency is 1/divisor MHz, divisor = {1, 1000} */
    /* {sysclk frequency, divisor} */
    {OSC_CONF_SYS_FREQ_MAX,    1},    /* High speed */
    {OSC_CONF_SYS_FREQ_NORMAL, 1},    /* Normal speed */
    {24,                       1},    /* Medium speed */
    {2,                        1},    /* Low speed, this is HCLK */
};

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

/**
 * This function configure clock tree
 *
 * @return SYSCLK or HCLK frequency (MHz)
 */
static rt_uint16_t clock_tree_config(struct rcc_conf_struct *conf, rt_uint32_t freq_base, rt_uint32_t freq_hclk)
{
    rt_uint32_t freq, freq_div, divm, divr, divq, div, mul, fs, i = 1U;
    rt_bool_t find = RT_FALSE;
    rt_bool_t usbclk_use_pll = RT_TRUE;

    freq_div = stm32_run_freq[conf->mode][1];

    RT_ASSERT(conf != RT_NULL && freq_hclk > 0);
    RT_ASSERT(freq_div == 1U || freq_div == 1000U);

    freq_base = freq_base / 1000U * freq_div;

    if (freq_div == 1 && conf->pll_state == RCC_PLL_ON && freq_hclk >= (OSC_CONF_PLL_VCO_FREQ_MIN / OSC_CONF_PLLR_DIV_MAX))
    {
        /* Use PLL */
        conf->sysclk_source = RCC_SYSCLKSOURCE_PLLCLK;

        while (1)
        {
#if defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE)
            if (usbclk_use_pll && (((freq_hclk % 48U == 0) && (freq_hclk / 48U <= 4U))
                    || ((48U % freq_hclk == 0) && (48U / freq_hclk <= 4U))))
            {
                if (freq_hclk / 48U > 0)
                {
                    div = get_stein_div((freq_hclk << 1U), freq_base);
                }
                else
                {
                    div = get_stein_div((48U << 1U), freq_base);
                }
            }
            else
            {
                div = get_stein_div((freq_hclk << 1U), freq_base);
            }
#else
            usbclk_use_pll = RT_FALSE;
            div = get_stein_div((freq_hclk << 1U), freq_base);
#endif
            mul = (freq_hclk << 1U) / div;
            div = (freq_base / div) << 1U;

            i = 1U;
            while (!find)
            {
                /* Get the PLLN multiplier */
                while (mul * i < OSC_CONF_PLLN_MUL_MIN || div * i < OSC_CONF_PLLM_DIV_MIN * OSC_CONF_PLLR_DIV_MIN)
                    i++;
                mul *= i;
                div *= i;

                if (mul > OSC_CONF_PLLN_MUL_MAX || div > OSC_CONF_PLLM_DIV_MAX * OSC_CONF_PLLR_DIV_MAX)
                    break;

                /* Get the PLLM divider */
                for (divm = OSC_CONF_PLLM_DIV_MAX; divm >= OSC_CONF_PLLM_DIV_MIN; divm--)
                {
                    freq = freq_base / divm;
                    if (freq < OSC_CONF_PLLM_FREQ_MIN || div / divm < OSC_CONF_PLLR_DIV_MIN
                            || freq * mul < OSC_CONF_PLL_VCO_FREQ_MIN)
                        continue;
                    if (freq > OSC_CONF_PLLM_FREQ_MAX || div / divm > OSC_CONF_PLLR_DIV_MAX
                            || freq * mul > OSC_CONF_PLL_VCO_FREQ_MAX)
                        break;

                    if (div % divm == 0)
                    {
                        divr = freq * mul / freq_hclk;
                        /* Get the PLLQ divider */
#if defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE)
                        divq = freq * mul / 48U;
                        if (divq > OSC_CONF_PLLQ_DIV_MAX)
                            continue;
                        if (divq < OSC_CONF_PLLQ_DIV_MIN)
                            break;
                        conf->clk48_source = RCC_USBCLKSOURCE_PLL;
#else
                        divq = OSC_CONF_PLLQ_DIV_MAX;
#endif
                        find = RT_TRUE;
                        break;
                    }
                }
                i++;
            }

            if (find)
                break;

            /* Does not meet the optimal frequency */
#if defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE)
            if (usbclk_use_pll)
            {
                usbclk_use_pll = RT_FALSE;
                conf->clk48_source = RCC_USBCLKSOURCE_HSI48;
            }
            else
#endif
            {
                freq_hclk--;
                usbclk_use_pll = RT_TRUE;
                if (freq_hclk < (OSC_CONF_PLL_VCO_FREQ_MIN / OSC_CONF_PLLR_DIV_MAX))
                {
                    rt_kprintf("error: Incorrect system frequency settings.\n");
                    RT_ASSERT(0);
                    break;
                }
            }
        }

        freq = freq_base * mul / (divm * divr);

        conf->pllm = divm;
        conf->plln = mul;
        conf->pllr = divr & 0xfe;
        conf->pllq = divq & 0xfe;
        conf->pllp = _rcc_conf[PM_RUN_MODE_NORMAL_SPEED].pllp;
        conf->ahb_div = RCC_SYSCLK_DIV1;
    }
    else
    {
        conf->pll_state = RCC_PLL_OFF;

        /* Select HSI for SYSCLK source */
        freq_base = HSI_VALUE / 1000000U * freq_div;
        conf->sysclk_source = RCC_SYSCLKSOURCE_HSI;

        /* Get the AHB divider */
        for (div = 0U; div <= 8U; div++)
        {
            if (div == 8U || (freq_base >> div) <= freq_hclk)
                break;
        }

        freq = freq_base >> div;

        if (div) div += 7U;
        conf->ahb_div = (div << RCC_CFGR_HPRE_Pos) & RCC_CFGR_HPRE;

        /* configure the Low-power Run mode */
        if ((freq / freq_div) <= OSC_CONF_LOW_POW_RUN_FREQ)
            conf->low_pow_run_en = RT_TRUE;
        else
            conf->low_pow_run_en = RT_FALSE;
    }

    (void)div;
    (void)mul;
    (void)divm;
    (void)divr;
    (void)divq;
    (void)find;
    (void)usbclk_use_pll;

    /* Find voltage scales range */
    conf->volt_scale = _volt_scale_tab[PM_POW_VOLT_SCALE_NUMS - 1U][0];
    fs = _volt_scale_tab[0][1];
    for (i = 0; i < PM_POW_VOLT_SCALE_NUMS; i++)
    {
        if ((freq / freq_div) <= _volt_scale_tab[i][2])
        {
            conf->volt_scale = _volt_scale_tab[i][0];
            /* frequency step for flash latency */
            fs = _volt_scale_tab[i][1];
            break;
        }
    }

    /* Find flash access latency */
    conf->latency = ((rt_uint32_t)(FLASH_LATENCY_MAX_NUMS - 1U) << FLASH_ACR_LATENCY_Pos) & FLASH_ACR_LATENCY;
    for (i = 1; i <= FLASH_LATENCY_MAX_NUMS; i++)
    {
        if ((freq / freq_div) <= fs * i)
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
            conf->pllm = ((RCC->PLLCFGR & RCC_PLLCFGR_PLLM) >> RCC_PLLCFGR_PLLM_Pos) + 1U;
            conf->plln = (RCC->PLLCFGR & RCC_PLLCFGR_PLLN) >> RCC_PLLCFGR_PLLN_Pos;
            conf->pllr = (((RCC->PLLCFGR & RCC_PLLCFGR_PLLR) >> RCC_PLLCFGR_PLLR_Pos) + 1U) << 1U;
            conf->pllq = (((RCC->PLLCFGR & RCC_PLLCFGR_PLLQ) >> RCC_PLLCFGR_PLLQ_Pos) + 1U) << 1U;
            conf->pllp = (RCC->PLLCFGR & RCC_PLLCFGR_PLLPDIV) >> RCC_PLLCFGR_PLLPDIV_Pos;
        }
        else
        {
            conf->pllp = RCC_PLLP_DIV2;
        }
        conf->clk48_source = RCC->CCIPR & RCC_CCIPR_CLK48SEL;
        conf->ahb_div = RCC->CFGR & RCC_CFGR_HPRE;
        conf->latency = FLASH->ACR & FLASH_ACR_LATENCY;
        conf->volt_scale = HAL_PWREx_GetVoltageRange();
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
        RCC_OscInitStruct.PLL.PLLR = conf->pllr;
        RCC_OscInitStruct.PLL.PLLQ = conf->pllq;
        RCC_OscInitStruct.PLL.PLLP = conf->pllp;
    }

#if defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE)
    if (conf->clk48_source == RCC_USBCLKSOURCE_HSI48)
    {
        RCC_OscInitStruct.OscillatorType |= RCC_OSCILLATORTYPE_HSI48;
        RCC_OscInitStruct.HSI48State = RCC_HSI48_ON;
    }
#endif

    if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
    {
        Error_Handler();
    }

    /* Reconfigure the SYSCLK and HCLK */
    RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK;
    RCC_ClkInitStruct.SYSCLKSource = conf->sysclk_source;
    RCC_ClkInitStruct.AHBCLKDivider = conf->ahb_div;
    if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, conf->latency) != HAL_OK)
    {
        Error_Handler();
    }

#if defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE)
    __HAL_RCC_USB_CONFIG(conf->clk48_source);
#endif
}

static void systemclock_msi_on(rt_uint32_t mode)
{
    RCC_OscInitTypeDef RCC_OscInitStruct = {0};
    RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};
    rt_uint32_t sysclk_source;

    sysclk_source = __HAL_RCC_GET_SYSCLK_SOURCE();
    if ((sysclk_source != RCC_SYSCLKSOURCE_STATUS_HSI)
            || (sysclk_source == RCC_SYSCLKSOURCE_STATUS_PLLCLK
                && __HAL_RCC_GET_PLL_OSCSOURCE() != RCC_PLLSOURCE_HSI))
    {
        RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
        RCC_OscInitStruct.HSIState = RCC_HSI_ON;
        RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
        RCC_OscInitStruct.PLL.PLLState = RCC_PLL_NONE;  /* No update on PLL */
        if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
        {
            Error_Handler();
        }
    }

    RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK;
    RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
    if (_rcc_conf[mode].volt_scale == PWR_REGULATOR_VOLTAGE_SCALE2 && SystemCoreClock > (rt_uint32_t)8000000U)
        /* HCLK must not be over than 8MHz with FLASH_LATENCY_0 in voltage range2 */
        RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV2;
    else
        RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
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
        if (pm->run_mode == PM_RUN_MODE_LOW_SPEED)
        {
            /* Enter LP SLEEP Mode, Enable low-power regulator */
            HAL_PWR_EnterSLEEPMode(PWR_LOWPOWERREGULATOR_ON, PWR_SLEEPENTRY_WFI);
        }
        else
        {
            /* Enter SLEEP Mode, Main regulator is ON */
            HAL_PWR_EnterSLEEPMode(PWR_MAINREGULATOR_ON, PWR_SLEEPENTRY_WFI);
        }
        break;

    case PM_SLEEP_MODE_DEEP:
        /* Disable SysTick interrupt */
        CLEAR_BIT(SysTick->CTRL, (rt_uint32_t)SysTick_CTRL_TICKINT_Msk);
        /* Enter STOP1 mode  */
        HAL_PWREx_EnterSTOP1Mode(PWR_STOPENTRY_WFI);
        /* Enable SysTick interrupt */
        SET_BIT(SysTick->CTRL, (rt_uint32_t)SysTick_CTRL_TICKINT_Msk);
        /* Re-configure the system clock */
        systemclock_reconfig(pm->run_mode);
        break;

    case PM_SLEEP_MODE_STANDBY:
        __HAL_PWR_CLEAR_FLAG(PWR_FLAG_WU);
        /* Enter STANDBY mode */
        HAL_PWR_EnterSTANDBYMode();
        break;

    case PM_SLEEP_MODE_SHUTDOWN:
        __HAL_PWR_CLEAR_FLAG(PWR_FLAG_WU);
        /* Enter SHUTDOWN mode */
        HAL_PWREx_EnterSHUTDOWNMode();
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
    struct rcc_conf_struct sconf = _rcc_conf[mode];

    if (mode == last_mode)
        return;

    if (stm32_run_freq[mode][0] != stm32_run_freq[last_mode][0])
    {
        if (_rcc_conf[last_mode].low_pow_run_en && !sconf.low_pow_run_en)
        {
            /* Disable the Low-power Run mode */
            HAL_PWREx_DisableLowPowerRunMode();
        }

        systemclock_msi_on(last_mode);

        if (mode < last_mode)
        {
            /* frequency up */
            HAL_PWREx_ControlVoltageScaling(sconf.volt_scale);
            _set_sysclock[mode]();
        }
        else
        {
            /* frequency down */
            _set_sysclock[mode]();
            HAL_PWREx_ControlVoltageScaling(sconf.volt_scale);
        }

        if (sconf.low_pow_run_en)
        {
            /* Enable the Low-power Run mode */
            HAL_PWREx_EnableLowPowerRunMode();
        }

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
