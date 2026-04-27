//rt_uint8_t type 1 1234
//rt_uint8_t type 2 2143
//rt_uint8_t type 3 3412
//rt_uint8_t type 4 4321
//  类型=*(类型*)charbuf2short(&Ultrasonic_Data[11],3412) ;
//函数作用数据类型转换
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

//CRC计算函数
uint16_t MOD_CRC16(uint8_t *Ddata,uint16_t length)   
{ 
  uint8_t i; 
  uint16_t crc_result=0xffff; 
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
//函数作用mobus发送数据指令      设备地址          寄存器地址         数据长度
rt_uint16_t  UART2GET_MODEBUS(rt_uint16_t slv ,rt_uint16_t adder ,rt_uint16_t length) 
{
	
	rt_uint16_t CRCC;

    Ultrasonic_Data[0]=slv;
    Ultrasonic_Data[1]=0X03;	
    Ultrasonic_Data[2]=(adder>>8);
    Ultrasonic_Data[3]=adder;
    Ultrasonic_Data[4]=0X00;
    Ultrasonic_Data[5]=length;
    CRCC = MOD_CRC16(&Ultrasonic_Data[0],6);
    Ultrasonic_Data[6]=(CRCC>>8);
    Ultrasonic_Data[7]=(CRCC);
		Ultrasonic_Data[8]=00;
    UART2PutString(&Ultrasonic_Data[0],9);//该函数根据客户实际代码实现替换
		
}

//函数作用: 解包接收到数据
char openpack(uint8_t *dst,uint16_t Startadd,uint8_t len)
{
    
	  unsigned short  CRC_D;
	  short           wendu;//温度
	  unsigned short  shidu,EC,yanfen,dan,lin,jia,ph;
	   
	  //串口发送读取数据指令 设备地址0，寄存器地址0，数据长度8
	  UART2GET_MODEBUS(0,0 ,8) 
	 // 根据客户实际情况接收数据由客户实现
	 //复制出来方便串口继续接收
		memcpy(&RxBuffer1[0],&Usart1.RxBuffer[0],Usart1.Count_Rx);
    CRC_D = MOD_CRC16(&RxBuffer1[0],Usart1.Count_Rx-2); 
    if(CRC_D != ((RxBuffer1[Usart1.Count_Rx-2]<<8) + (RxBuffer1[Usart1.Count_Rx-1]))) //判断CRC
    {
		   return 0;  //数据校验失败返回
    }
	  else
	  {		 
			wendu  = *(short*)charbuf2short(&Ultrasonic_Data[3+0*2],21) ;   //温度  
			shidu  = *(short*)charbuf2short(&Ultrasonic_Data[3+1*2],21) ;   //湿度
			EC     = *(short*)charbuf2short(&Ultrasonic_Data[3+2*2],21) ;   //EC
			yanfen = *(short*)charbuf2short(&Ultrasonic_Data[3+3*2],21) ;   //盐分
			dan    = *(short*)charbuf2short(&Ultrasonic_Data[3+4*2],21) ;   //氮
			lin    = *(short*)charbuf2short(&Ultrasonic_Data[3+5*2],21) ;   //磷
			jia    = *(short*)charbuf2short(&Ultrasonic_Data[3+6*2],21) ;   //钾
			ph     = *(short*)charbuf2short(&Ultrasonic_Data[3+7*2],21) ;   //PH	
				
	  }
} 






















