/*
 * 程序清单：这是一个 串口 设备使用例程
 * 例程导出了 uart_sample 命令到控制终端
 * 命令调用格式：uart_sample uart2
 * 命令解释：命令第二个参数是要使用的串口设备名称，为空则使用默认的串口设备
 * 程序功能：通过串口输出字符串"hello RT-Thread!"，然后错位输出输入的字符
*/

#include <rtthread.h>
#include <rtdevice.h> 
#include <drv_gpio.h>
#include <rtdef.h>
#include <string.h>
#define  SAMPLE_UART_NAME       "uart2"

#define RS485EN2   GET_PIN(A, 1)    

extern rt_uint8_t  SAVECamera(void);
extern rt_uint8_t  SaveTime ;    
extern rt_uint8_t  SendDataToDisplay(void);
/* 用于接收消息的信号量 */
static struct         rt_semaphore rx_sem2;
static rt_device_t    serial2;
       rt_uint8_t     SensorOK     = 0;
       rt_uint8_t     SensorFlag   = 1;
static rt_uint8_t     addid        = 0;
static rt_uint8_t     SensorDataID = 0;
static rt_uint8_t     Number485;            //传感器数量
static rt_uint8_t     Ce_Zhan_Type;         //测站类型
static rt_uint8_t     CT485[20][4];         //传感器配置表
       short          SenData[32];                  
			 char           DataTime[6];          //数据时间
static rt_uint8_t     Ultrasonic_Data[50];
       rt_uint8_t     send485datalen;
			 
struct rt_timer timersensor;               //传感器定时器
                                           //传感器地址    寄存器地址    读取数据长度
const rt_uint8_t __485DefluatTbale[][4]={   
																					{2,               0,         8}, 
                                        };
//rt_uint8_t type 1 1234
//rt_uint8_t type 2 2143
//rt_uint8_t type 3 3412
//rt_uint8_t type 4 4321
//  类型=*(类型*)charbuf2int(&Ultrasonic_Data[11],3412) ;
void *charbuf2int(rt_uint8_t *buf,const short type)
{
		rt_uint8_t data[4]={0,0,0,0};
	  if(type == 1234)
		{
			data[3] = buf[0];
			data[2] = buf[1];
			data[1] = buf[2];
			data[0] = buf[3];
		}
		else if(type == 3412)
		{
			data[3] = buf[2];
			data[2] = buf[3];
			data[1] = buf[0];
			data[0] = buf[1];
		}
	  else if(type == 2143)
		{
			data[3] = buf[1];
			data[2] = buf[0];
			data[1] = buf[3];
			data[0] = buf[2];
		}
	  else if(type == 4321)
		{
			data[3] = buf[3];
			data[2] = buf[2];
			data[1] = buf[1];
			data[0] = buf[0];
		}
	return data;
}
//rt_uint8_t type 1 1234
//rt_uint8_t type 2 2143
//rt_uint8_t type 3 3412
//rt_uint8_t type 4 4321
//  类型=*(类型*)charbuf2short(&Ultrasonic_Data[11],3412) ;
void *charbuf2short(rt_uint8_t *buf,const short type)
{
		rt_uint8_t data[2]={0,0};
	  if(type == 12)
		{
			data[0] = buf[0];
			data[1] = buf[1];
		}
		else 
		{
			data[0] = buf[1];
			data[1] = buf[0];
		}
	return data;
}

unsigned int MOD_CRC16(unsigned char *Ddata,unsigned char length)   
{ 
    unsigned int i; 
    unsigned crc_result=0xffff; 
	while(length--) 
	{ 
	    crc_result^=*Ddata++; 
		for(i=0;i<8;i++) 
	    { 
	         if(crc_result&0x01) 
	               crc_result=(crc_result>>1)^0xa001; 
	        else 
	               crc_result=crc_result>>1; 
	    } 
	} 
	return (crc_result=((crc_result&0xff)<<8)|(crc_result>>8)); 
}
/* 接收数据回调函数 */
static rt_err_t uart_input(rt_device_t dev, rt_size_t size)
{
    /* 串口接收到数据后产生中断，调用此回调函数，然后发送接收信号量 */
    rt_sem_release(&rx_sem2);
    return RT_EOK;
}


rt_uint16_t UART2Getch(rt_err_t *err, rt_uint16_t TimeOut)
{
	  rt_uint16_t Data;
    /* 阻塞等待接收信号量，等到信号量后再次读取数据 */
     *err = rt_sem_take(&rx_sem2, TimeOut);  
    /* 从串口读取一个字节的数据，没有读取到则等待接收信号量 */
     if(*err == RT_EOK)
     {
       if(rt_device_read(serial2, -1, &Data, 1) == 0)
       {
          *err = -RT_ETIMEOUT;
       }
       else
          *err = RT_EOK;
        return Data ;			    					//返回
     }
     else
       *err  = -RT_ETIMEOUT;
     return 0 ;			    					//返回       
}
/*********************************************************************************************************
** 函数名称 ：ClearUart2
** 函数功能 ：清空串口4的接收数据队列
** 入口参数 ：无           			  
** 出口参数 ：无
              
*********************************************************************************************************/
void ClearUart2(void)
{
  rt_err_t err;
  rt_uint16_t Data;
	while(1)
	{  
     err = rt_sem_take(&rx_sem2, 10);  
     if(err == RT_EOK)
     {
       rt_device_read(serial2, -1, &Data, 1);
     }
     else
     break;  
	}
}

void UART2PutString(char *src, rt_uint8_t len)
{
  rt_pin_write(RS485EN2, PIN_HIGH);    
  rt_thread_mdelay(1);
  rt_device_write(serial2, 0, src, len);
	rt_thread_mdelay(2);
  rt_pin_write(RS485EN2, PIN_LOW);  

}

rt_uint16_t  UART2GET_MODEBUS(rt_uint16_t slv ,rt_uint16_t adder ,rt_uint16_t length,rt_uint16_t type) 
{
	char i , temp ,x=0,count=0;
  rt_err_t err;
	rt_uint16_t CRCC;
	for(x=0;x<3;x++)
  {
    ClearUart2();
    Ultrasonic_Data[0]=slv;
    if(type==0x04)
      Ultrasonic_Data[1]=0X04;
    else
      Ultrasonic_Data[1]=0X03;	
    Ultrasonic_Data[2]=(adder>>8);
    Ultrasonic_Data[3]=adder;
    Ultrasonic_Data[4]=0X00;
    Ultrasonic_Data[5]=length;
    CRCC = MOD_CRC16(&Ultrasonic_Data[0],6);
    Ultrasonic_Data[6]=(CRCC>>8);
    Ultrasonic_Data[7]=(CRCC);
    UART2PutString(&Ultrasonic_Data[0],8);
    temp= length*2+5;
    if( temp >100)  
      return 0;
    for(i=0;i<16;i++)												//清空数据缓冲区
    {
      Ultrasonic_Data[i]=0;	
    }
    for(i=0;i<temp+2;i++)
    {
      Ultrasonic_Data[i]=UART2Getch(&err,100);	
      if(err!=RT_EOK)
      {
        	break ;									
      }			
    }
		/*修改 20210403 增加过滤前面乱码问题*/
		for(count=0;count<=i;count++)
		{
		  if(Ultrasonic_Data[count] == slv)
				break;
		}
		if((i-count)<temp)
			return 0;
		else
		{
			memcpy(Ultrasonic_Data,&Ultrasonic_Data[count],temp);
		}
		/************************************/
    CRCC = MOD_CRC16(&Ultrasonic_Data[0],temp-2);

    if((Ultrasonic_Data[temp-1] == (CRCC%256)) && (Ultrasonic_Data[temp-2] == CRCC/256) &&( Ultrasonic_Data[2]== length*2)) 
    {
      if((i!=0) && (Ultrasonic_Data[0]== slv ))		
        return  1;
    }  
  }
  return 0;
}
static void serial2_thread_entry(void *parameter)
{
    rt_uint8_t      rcmd[16],flag=0;
	  rt_uint16_t  k=0;
    short  data; 	
		time_t now;
		struct tm *p_tm;
    SensorOK = 0;
    Number485 = sizeof(__485DefluatTbale)/sizeof(__485DefluatTbale[0]);
    memcpy(CT485,__485DefluatTbale,4*Number485);
    memset((rt_uint8_t*)&SenData,0,32);     
    while (1)
    {     
			SensorDataID = 0;   //数据地址清零 			
			for(addid=0;addid<Number485;addid++)
			{
				if(UART2GET_MODEBUS(CT485[addid][0] ,CT485[addid][1] ,CT485[addid][2],0))					
				 {
					for(k=0;k<CT485[addid][2];k++)                                             
					{
						 
						 data = *(short*)charbuf2short(&Ultrasonic_Data[3+k*2],21) ;    
						 {
							 SenData[SensorDataID] = data;                                      //更新数据
						 }
						 SensorDataID++;
					}
				} 
				else
				{
					for(k=0;k<CT485[addid][2];k++)
					{
						SensorDataID++;
					}            
				}
		 }
		 rt_thread_mdelay(5*1000);

   }
}

int uart2_sample()
{
    rt_err_t ret = RT_EOK;
    char uart_name[RT_NAME_MAX];
    struct serial_configure config = RT_SERIAL_CONFIG_DEFAULT;
    config.baud_rate = 9600;
  
    rt_strncpy(uart_name, SAMPLE_UART_NAME, RT_NAME_MAX);

    /* 查找系统中的串口设备 */
    serial2 = rt_device_find(uart_name);
    if (!serial2)
    {
        rt_kprintf("find %s failed!\n", uart_name);
        return RT_ERROR;
    }
    /* 设置串口的波特率 */
    rt_device_control(serial2, RT_DEVICE_CTRL_CONFIG, &config);
        
    /* 初始化信号量 */
    rt_sem_init(&rx_sem2, "rx_sem2", 0, RT_IPC_FLAG_FIFO);
    /* 以中断接收及轮询发送模式打开串口设备 */
    rt_device_open(serial2, RT_DEVICE_FLAG_INT_RX);
    /* 设置接收回调函数 */
    rt_device_set_rx_indicate(serial2, uart_input);
		
 
    /* 创建 serial 线程 */
    rt_thread_t thread = rt_thread_create("serial2", serial2_thread_entry, RT_NULL, 1024, 8, 10);
    /* 创建成功则启动线程 */
    if (thread != RT_NULL)
    {
        rt_thread_startup(thread);
    }
    else
    {
        ret = RT_ERROR;
    }

    return ret;
}

static void showdata(void )
{
   rt_uint8_t i,l;
   rt_uint8_t s[100];
   for(i = 0;i<32;i++)
   {
     rt_kprintf("%d\r\n", SenData[i]);
   }
}

MSH_CMD_EXPORT(showdata, show data);