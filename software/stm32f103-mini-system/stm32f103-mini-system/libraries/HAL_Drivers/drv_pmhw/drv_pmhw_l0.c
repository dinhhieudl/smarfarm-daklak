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
/* STM32L0 */
#define OSC_CONF_SYS_FREQ_MAX       32U     /* Max system clock  MHz */
#define OSC_CONF_PLL_VI_FREQ_MIN    2U      /* Min pll vco input clock  MHz */
#define OSC_CONF_PLL_VI_FREQ_MAX    24U     /* Min pll vco input clock  MHz */
#define OSC_CONF_PLL_SYS_FREQ_MIN   2U      /* Min system clock with pll on  MHz */
#define OSC_CONF_PLL_FREQ_MAX       96U     /* Max pll clock  MHz */
#define OSC_CONF_PLL_DIV_MIN        2U      /* Min pll divider */
#define OSC_CONF_PLL_DIV_MAX        4U      /* Max pll divider */
#define OSC_CONF_PLL_MUL_MAX_NUMS   9U

#define FLASH_LATENCY_MAX_NUMS      2U
#define PM_POW_VOLT_SCALE_NUMS      3U

struct rcc_conf_struct
{
    rt_uint32_t mode;
    rt_uint32_t sysclk_source;
#if defined(USB)
    rt_uint32_t clk48_source;
#endif
    rt_uint32_t pll_state;
    rt_uint32_t pll_div;
    rt_uint32_t pll_mul;
    rt_uint32_t hsi_div;
    rt_uint32_t ahb_div;
    rt_uint32_t latency;
    rt_uint32_t volt_scale;
    rt_uint32_t msi_range;
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
static const rt_uint32_t _volt_scale_tab[PM_POW_VOLT_SCALE_NUMS][4] =
{
    /* voltage range, frequency step for flash latency, max HCLK, max PLL_VCO frequency */
    {PWR_REGULATOR_VOLTAGE_SCALE3,  4U,  4U, 24U},
    {PWR_REGULATOR_VOLTAGE_SCALE2,  8U, 16U, 48U},
    {PWR_REGULATOR_VOLTAGE_SCALE1, 16U, 32U, 96U},
};
static const rt_uint8_t _pll_mul_tab[OSC_CONF_PLL_MUL_MAX_NUMS] =
{
    3U, 4U, 6U, 8U, 12U, 16U, 24U, 32U, 48U
};

RT_WEAK rt_uint16_t stm32_run_freq[PM_RUN_MODE_MAX][2] =
{
    /* The actual frequency is 1/divisor MHz, divisor = {1, 1000} */
    /* {sysclk frequency, divisor} */
    {32,       1},    /* High speed */
    {32,       1},    /* Normal speed */
    {12,       1},    /* Medium speed */
    {2097,  1000},    /* Low speed, MSI clock 2.097 MHz */
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
    rt_uint32_t freq, freq_div, mul, div, multmp, divtmp, fs, i, j, freq_vco = 0U;
    rt_bool_t find = RT_FALSE;
    rt_bool_t usbclk_use_pll = RT_TRUE;

    freq_div = stm32_run_freq[conf->mode][1];

    RT_ASSERT(conf != RT_NULL && freq_hclk > 0);
    RT_ASSERT(freq_div == 1U || freq_div == 1000U);

    freq_base = freq_base / 1000U * freq_div;

    if (_osc_conf.osc_type == RCC_OSCILLATORTYPE_HSI)
    {
        freq = freq_base >> 2U;
        conf->hsi_div = RCC_CR_HSIDIVEN;
    }
    else
    {
        freq = freq_base;
    }

    if (freq_div == 1 && conf->pll_state == RCC_PLL_ON && freq_hclk >= OSC_CONF_PLL_SYS_FREQ_MIN)
    {
        /* Use PLL */
        conf->sysclk_source = RCC_SYSCLKSOURCE_PLLCLK;

        while (1)
        {
#if defined(USB) && (defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE))
            if (usbclk_use_pll && ((48U << 1U) % freq_hclk == 0)
                    && ((48U << 1U) / freq_hclk <= OSC_CONF_PLL_DIV_MAX))
            {
                div = get_stein_div((48U << 1U), freq);
            }
            else
            {
                div = get_stein_div(freq_hclk, freq);
            }
#else
            usbclk_use_pll = RT_FALSE;
            div = get_stein_div(freq_hclk, freq);
#endif
            mul = freq_hclk / div;
            div = freq / div;

            i = 1U;
            while (!find)
            {
                /* Get the PLL multiplier and divider */
                multmp = mul * i;
                divtmp = div * i;
                if (multmp >= _pll_mul_tab[0] && divtmp >= OSC_CONF_PLL_DIV_MIN)
                {
                    if (multmp > _pll_mul_tab[OSC_CONF_PLL_MUL_MAX_NUMS - 1U] || divtmp > OSC_CONF_PLL_DIV_MAX)
                        break;

                    for (j = 0U; j < OSC_CONF_PLL_MUL_MAX_NUMS; j++)
                    {
                        if (multmp == _pll_mul_tab[j])
                        {
                            /* PLL multiplier is correct */
                            find = RT_TRUE;
                            freq_vco = freq * multmp;
                            freq = freq_hclk;
                            mul = j;
                            div = divtmp;
#if defined(USB) && (defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE))
                            conf->clk48_source = RCC_USBCLKSOURCE_PLL;
#endif
                            (void) j;
                            (void) multmp;
                            (void) divtmp;
                            break;
                        }
                    }
                }
                i++;
            }

            if (find)
                break;

            /* Does not meet the optimal frequency */
#if defined(USB) && (defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE))
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
                if (freq_hclk < OSC_CONF_PLL_SYS_FREQ_MIN)
                {
                    rt_kprintf("error: Incorrect system frequency settings.\n");
                    RT_ASSERT(0);
                    break;
                }
            }
        }

        (void)find;
        (void)usbclk_use_pll;

        conf->pll_mul = (mul << RCC_CFGR_PLLMUL_Pos) & RCC_CFGR_PLLMUL;
        conf->pll_div = ((div - 1U) << RCC_CFGR_PLLDIV_Pos) & RCC_CFGR_PLLDIV;
        conf->ahb_div = RCC_SYSCLK_DIV1;
    }
    else if (freq_div == 1U || (freq_hclk % 125U) == 0)
    {
        conf->pll_state = RCC_PLL_OFF;

        /* Select HSI as SYSCLK source */
        freq_base = HSI_VALUE / 1000000U * freq_div;
        conf->sysclk_source = RCC_SYSCLKSOURCE_HSI;

        /* Get the HSI prescaler */
        if (freq_hclk == freq_base)
        {
            freq = freq_base;
            conf->hsi_div = 0U;
        }
        else
        {
            freq = freq_base >> 2U;
            conf->hsi_div = RCC_CR_HSIDIVEN;
        }

        /* Get AHB divider */
        for (div = 0U; div <= 8U; div++)
        {
            if (div == 8U || (freq >> div) <= freq_hclk)
                break;
        }
        freq >>= div;
        if (div) div += 7U;
        conf->ahb_div = (div << RCC_CFGR_HPRE_Pos) & RCC_CFGR_HPRE;
    }
    else
    {
        conf->pll_state = RCC_PLL_OFF;

        /* Select MSI and find the MSI frequency range */
        freq = 32768U;
        for (i = 0U; i < 7U; i++)
        {
            freq <<= 1U;
            if (freq_hclk < freq / 1000U)
            {
                break;
            }
        }
        if (i == 0U)
        {
            freq = 65U; /* 65.536 KHz */
        }
        else
        {
            /* back one */
            i--;
            freq >>= 1U;
            freq /= 1000U;
        }
        conf->sysclk_source = RCC_SYSCLKSOURCE_MSI;
        conf->msi_range = (i << RCC_ICSCR_MSIRANGE_Pos) & RCC_ICSCR_MSIRANGE;

        conf->ahb_div = RCC_SYSCLK_DIV1;

        /* In Low-power Run mode, the system frequency should not exceed f_MSI range1 */
        conf->low_pow_run_en = (i > 1) ? RT_FALSE : RT_TRUE;
    }

    (void)div;
    (void)mul;

    /* Find voltage scales range */
    conf->volt_scale = _volt_scale_tab[PM_POW_VOLT_SCALE_NUMS - 1U][0];
    fs = _volt_scale_tab[0][1];
    for (i = 0; i < PM_POW_VOLT_SCALE_NUMS; i++)
    {
        if (conf->low_pow_run_en)
        {
            /* Low-power run mode can only be entered when VCORE is in range 2 */
            if (_volt_scale_tab[i][0] == PWR_REGULATOR_VOLTAGE_SCALE2)
            {
                conf->volt_scale = _volt_scale_tab[i][0];
                /* frequency step for flash latency */
                fs = _volt_scale_tab[i][1];
                break;
            }
        }
        else
        {
            if ((freq / freq_div) <= _volt_scale_tab[i][2] && freq_vco <= _volt_scale_tab[i][3])
            {
                conf->volt_scale = _volt_scale_tab[i][0];
                /* frequency step for flash latency */
                fs = _volt_scale_tab[i][1];
                break;
            }
        }
    }

    (void)freq_vco;

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
    rt_uint32_t tmpreg, mode = PM_RUN_MODE_NORMAL_SPEED;
    struct rcc_conf_struct *conf = &_rcc_conf[mode];
    struct osc_conf_struct *osc = &_osc_conf;

    if (!osc->init)
    {
        tmpreg = RCC->CFGR;

        switch (tmpreg & RCC_CFGR_SWS)
        {
        case RCC_SYSCLKSOURCE_STATUS_HSE:  /* HSE used as system clock */
            conf->pll_state = RCC_PLL_OFF;
            conf->sysclk_source = RCC_SYSCLKSOURCE_HSE;
            osc->osc_type = RCC_OSCILLATORTYPE_HSE;
            osc->osc_freq = HSE_VALUE / 1000U;
            break;
        case RCC_SYSCLKSOURCE_STATUS_PLLCLK:  /* PLL used as system clock */
            conf->pll_state = RCC_PLL_ON;
            conf->sysclk_source = RCC_SYSCLKSOURCE_PLLCLK;

            if ((tmpreg & RCC_CFGR_PLLSRC) == RCC_PLLSOURCE_HSE)
            {
                osc->osc_type = RCC_OSCILLATORTYPE_HSE;
                osc->osc_freq = HSE_VALUE / 1000U;
            }
            else
            {
                osc->osc_type = RCC_OSCILLATORTYPE_HSI;
                osc->osc_freq = HSI_VALUE / 1000U;
                conf->hsi_div = (RCC->CR & RCC_CR_HSIDIVF) >> 1U;
            }
            break;
        case RCC_SYSCLKSOURCE_STATUS_HSI:    /* HSI used as system clock source */
            conf->pll_state = RCC_PLL_OFF;
            conf->sysclk_source = RCC_SYSCLKSOURCE_HSI;
            conf->hsi_div = (RCC->CR & RCC_CR_HSIDIVF) >> 1U;
            osc->osc_type = RCC_OSCILLATORTYPE_HSI;
            osc->osc_freq = HSI_VALUE / 1000U;
            break;
        case RCC_SYSCLKSOURCE_STATUS_MSI:  /* MSI used as system clock source */
        default:  /* MSI used as system clock */
            conf->pll_state = RCC_PLL_OFF;
            conf->sysclk_source = RCC_SYSCLKSOURCE_MSI;
            conf->msi_range = RCC->ICSCR & RCC_ICSCR_MSIRANGE;
            osc->osc_type = RCC_OSCILLATORTYPE_MSI;
            osc->osc_freq = (32768U * (1UL << ((conf->msi_range >> RCC_ICSCR_MSIRANGE_Pos) + 1U))) / 1000U;
            break;
        }

        /* Get the normal run speed register settings */
        if (conf->pll_state == RCC_PLL_ON)
        {
            conf->pll_mul = RCC->CFGR & RCC_CFGR_PLLMUL;
            conf->pll_div = RCC->CFGR & RCC_CFGR_PLLDIV;
        }
        conf->ahb_div = RCC->CFGR & RCC_CFGR_HPRE;
        conf->latency = FLASH->ACR & FLASH_ACR_LATENCY;
        conf->volt_scale = HAL_PWREx_GetVoltageRange();
#if defined(USB) && (defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE))
        conf->clk48_source = RCC->CCIPR & RCC_CCIPR_HSI48SEL;
#endif
        stm32_run_freq[mode][0] = HAL_RCC_GetSysClockFreq() / 1000000U;

        if (conf->sysclk_source != RCC_SYSCLKSOURCE_MSI)
        {
            /* After wake-up from Stop mode, the HSI clock selected */
            __HAL_RCC_WAKEUPSTOP_CLK_CONFIG(RCC_STOP_WAKEUPCLOCK_HSI);
        }

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
    else if ((conf->pll_state == RCC_PLL_ON && _osc_conf.osc_type == RCC_OSCILLATORTYPE_HSI)
             || conf->sysclk_source == RCC_SYSCLKSOURCE_HSI)
    {
        RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
        RCC_OscInitStruct.HSIState = RCC_HSI_ON;
        RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
        MODIFY_REG(RCC->CR, RCC_CR_HSIDIVEN, conf->hsi_div);
        RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSI;
    }
    else
    {
        RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_MSI;
        RCC_OscInitStruct.MSIState = RCC_MSI_ON;
        RCC_OscInitStruct.MSIClockRange = conf->msi_range;
    }

#if defined(USB) && (defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE))
    if (conf->clk48_source == RCC_USBCLKSOURCE_HSI48)
    {
        RCC_OscInitStruct.OscillatorType |= RCC_OSCILLATORTYPE_HSI48;
        RCC_OscInitStruct.HSI48State = RCC_HSI48_ON;
    }
#endif

    RCC_OscInitStruct.PLL.PLLState = conf->pll_state;
    if (conf->pll_state == RCC_PLL_ON)
    {
        RCC_OscInitStruct.PLL.PLLMUL = conf->pll_mul;
        RCC_OscInitStruct.PLL.PLLDIV = conf->pll_div;
    }

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

#if defined(USB) && (defined(RT_USING_USB_HOST) || defined(RT_USING_USB_DEVICE))
    __HAL_RCC_USB_CONFIG(conf->clk48_source);
#endif
}

static void systemclock_msi_on(rt_uint32_t mode)
{
    RCC_OscInitTypeDef RCC_OscInitStruct = {0};
    RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

    if (__HAL_RCC_GET_SYSCLK_SOURCE() == RCC_SYSCLKSOURCE_STATUS_MSI)
    {
        RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_MSI;
    }
    else
    {
        RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
        RCC_OscInitStruct.HSIState = RCC_HSI_ON;
        RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
        RCC_OscInitStruct.PLL.PLLState = RCC_PLL_NONE; /* No update on PLL */
        if (_rcc_conf[mode].volt_scale == PWR_REGULATOR_VOLTAGE_SCALE1)
            MODIFY_REG(RCC->CR, RCC_CR_HSIDIVEN, 0UL); /* 16MHz HSI */
        else
            MODIFY_REG(RCC->CR, RCC_CR_HSIDIVEN, RCC_CR_HSIDIVEN_Msk); /* HSI/4 */
        if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
        {
            Error_Handler();
        }
        RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
    }

    RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK;
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
    else if (_rcc_conf[mode].sysclk_source != RCC_SYSCLKSOURCE_MSI)
        __HAL_RCC_MSI_DISABLE();
}

/**
  * @brief  Configures system clock after wake-up from STOP: enable MSI or HSI, PLL
  *         and select PLL as system clock source.
  * @param  None
  * @retval None
  */
static void systemclock_reconfig(rt_uint32_t mode)
{
    if (__HAL_RCC_GET_SYSCLK_SOURCE() == RCC_SYSCLKSOURCE_STATUS_MSI && _rcc_conf[mode].sysclk_source == RCC_SYSCLKSOURCE_MSI)
        return;

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

    case PM_SLEEP_MODE_LIGHT:
        if (pm->run_mode == PM_RUN_MODE_LOW_SPEED)
        {
            __HAL_FLASH_SLEEP_POWERDOWN_ENABLE();
            /* Enter LP SLEEP Mode, Enable low-power regulator */
            HAL_PWR_EnterSLEEPMode(PWR_LOWPOWERREGULATOR_ON, PWR_SLEEPENTRY_WFI);
            __HAL_FLASH_SLEEP_POWERDOWN_DISABLE();
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
        /* Enable the Ultra Low Power mode and the fast wake up */
        SET_BIT(PWR->CR, PWR_CR_ULP | PWR_CR_FWU);
        /* Enter STOP mode  */
        HAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON, PWR_STOPENTRY_WFI);
        /* Disable the Ultra Low Power mode and the fast wake up */
        CLEAR_BIT(PWR->CR, PWR_CR_ULP | PWR_CR_FWU);
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
    rt_uint32_t wait_loop_index;
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

        if (sconf.volt_scale < _rcc_conf[last_mode].volt_scale)
        {
            /* VCORE voltage increase */
            __HAL_PWR_VOLTAGESCALING_CONFIG(sconf.volt_scale);
            /* Wait until VOSF is cleared */
            wait_loop_index = ((20U * SystemCoreClock) / 1000U) + 1U;
            while (wait_loop_index && HAL_IS_BIT_SET(PWR->CSR, PWR_CSR_VOSF))
            {
                wait_loop_index--;
            }
            if (HAL_IS_BIT_SET(PWR->CSR, PWR_CSR_VOSF))
            {
                return;
            }

            _set_sysclock[mode]();
        }
        else
        {
            /* VCORE voltage reduce */
            _set_sysclock[mode]();
            __HAL_PWR_VOLTAGESCALING_CONFIG(sconf.volt_scale);
        }

        if (sconf.sysclk_source == RCC_SYSCLKSOURCE_MSI)
        {
            /* After wake-up from Stop mode, the MSI clock selected */
            __HAL_RCC_WAKEUPSTOP_CLK_CONFIG(RCC_STOP_WAKEUPCLOCK_MSI);
            if (sconf.low_pow_run_en)
            {
                /* Enable the Low-power Run mode */
                HAL_PWREx_EnableLowPowerRunMode();
            }
        }
        else
        {
            /* After wake-up from Stop mode, the HSI clock selected */
            __HAL_RCC_WAKEUPSTOP_CLK_CONFIG(RCC_STOP_WAKEUPCLOCK_HSI);
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
