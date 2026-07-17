const CROP_STAGES = {
  robusta: {
    name: 'Cà phê Robusta',
    stages: [
      {
        id: 'dormant', name: 'Nghỉ (Rụng lá)', months: [11, 12, 1], durationDays: 90,
        description: 'Cây rụng lá, nghỉ sinh dưỡng sau vụ thu hoạch',
        irrigation: { target: 30, frequency: '2 tuần/lần', notes: 'Giữ ẩm nhẹ, không tưới nhiều' },
        fertilization: { N: 0, P: 0, K: 0, notes: 'Bón phân chuồng hoai mục + vôi bột' },
        risks: ['Sâu bệnh ẩn trong vỏ cây', 'Đất khô nứt nếu không tưới duy trì']
      },
      {
        id: 'flowering', name: 'Ra hoa', months: [2, 3], durationDays: 45,
        description: 'Cây ra hoa trắng, cần nước kích thích nở hoa đồng đều',
        irrigation: { target: 55, frequency: '1 lần/tuần', notes: 'Tưới đẫm kích thích ra hoa. Thiếu nước = hoa rụng, mất mùa.' },
        fertilization: { N: 40, P: 60, K: 40, notes: 'Bón phân lân (P) để kích thích ra hoa, bón NPK 16-16-8' },
        risks: ['Mưa trái mùa gây rụng hoa', 'Thiếu nước = hoa không nở', 'Sâu đục quả']
      },
      {
        id: 'fruit-set', name: 'Đậu quả', months: [3, 4, 5], durationDays: 60,
        description: 'Quả non bắt đầu phát triển, giai đoạn nhạy cảm nhất',
        irrigation: { target: 60, frequency: '1 lần/tuần', notes: 'Tươi đều đặn, đất khô = rụng quả non hàng loạt' },
        fertilization: { N: 60, P: 30, K: 60, notes: 'Bón NPK 20-10-10 + phân bón lá có chứa Bo, Zn' },
        risks: ['Rụng quả non nếu stress nước', 'Thiếu Kali = quả nhỏ', 'Bệnh gỉ sắt lá']
      },
      {
        id: 'fruit-growth', name: 'Phát triển quả', months: [5, 6, 7, 8], durationDays: 120,
        description: 'Quả lớn dần, tích lũy chất khô bên trong',
        irrigation: { target: 55, frequency: '1-2 lần/tuần', notes: 'Tươi duy trì, mùa mưa có thể giảm tưới' },
        fertilization: { N: 30, P: 20, K: 80, notes: 'Bón Kali (K) cao để quả to, chất lượng tốt. NPK 10-5-20.' },
        risks: ['Mưa nhiều → ngập úng', 'Bệnh thán thư', 'Sâu đục quả']
      },
      {
        id: 'ripening', name: 'Chín', months: [9, 10], durationDays: 60,
        description: 'Quả chuyển từ xanh → đỏ, tích lũy caffeine và đường',
        irrigation: { target: 40, frequency: 'Giảm tưới', notes: 'Giảm nước để quả chín đều, tăng chất lượng' },
        fertilization: { N: 0, P: 0, K: 40, notes: 'Bón Kali nhẹ để quả ngọt hơn. Ngưng phân đạm.' },
        risks: ['Mưa nhiều → quả thối', 'Chín không đều', 'Rụng quả trước thu hoạch']
      },
      {
        id: 'harvest', name: 'Thu hoạch', months: [10, 11], durationDays: 45,
        description: 'Thu hoạch quả chín đỏ, sơ chế',
        irrigation: { target: 35, frequency: 'Tươi nhẹ sau thu hoạch', notes: 'Tươi phục hồi sau thu hoạch' },
        fertilization: { N: 20, P: 20, K: 20, notes: 'Bón phân phục hồi sau thu hoạch' },
        risks: ['Thiếu nhân công thu hoạch', 'Quả rụng mất', 'Sơ chế không kịp → giảm chất lượng']
      }
    ]
  },
  arabica: {
    name: 'Cà phê Arabica',
    stages: [
      {
        id: 'dormant', name: 'Nghỉ', months: [11, 12, 1], durationDays: 90,
        description: 'Giai đoạn nghỉ sau thu hoạch',
        irrigation: { target: 30, frequency: '2 tuần/lần', notes: 'Giữ ẩm nhẹ' },
        fertilization: { N: 0, P: 0, K: 0, notes: 'Bón phân chuồng + vôi' },
        risks: ['Sâu bệnh', 'Đất khô']
      },
      {
        id: 'flowering', name: 'Ra hoa', months: [2, 3], durationDays: 40,
        description: 'Hoa trắng, thơm',
        irrigation: { target: 55, frequency: '1 lần/tuần', notes: 'Tưới đẫm' },
        fertilization: { N: 30, P: 50, K: 30, notes: 'Bón lân kích thích ra hoa' },
        risks: ['Mưa trái mùa', 'Thiếu nước']
      },
      {
        id: 'fruit-set', name: 'Đậu quả', months: [3, 4], durationDays: 50,
        description: 'Quả non phát triển',
        irrigation: { target: 60, frequency: '1 lần/tuần', notes: 'Tưới đều' },
        fertilization: { N: 50, P: 25, K: 50, notes: 'NPK 20-10-10' },
        risks: ['Rụng quả non', 'Bệnh gỉ sắt']
      },
      {
        id: 'fruit-growth', name: 'Phát triển quả', months: [4, 5, 6, 7, 8], durationDays: 150,
        description: 'Quả lớn, Arabica cần nhiều nước hơn Robusta',
        irrigation: { target: 60, frequency: '2 lần/tuần', notes: 'Arabica nhạy cảm thiếu nước hơn Robusta' },
        fertilization: { N: 30, P: 20, K: 70, notes: 'Kali cao cho quả to' },
        risks: ['Nhiệt độ cao → stress', 'Thiếu nước → quả nhỏ']
      },
      {
        id: 'ripening', name: 'Chín', months: [9, 10], durationDays: 60,
        description: 'Quả chín đỏ',
        irrigation: { target: 45, frequency: 'Giảm', notes: 'Giảm nước cho quả chín đều' },
        fertilization: { N: 0, P: 0, K: 30, notes: 'Kali nhẹ' },
        risks: ['Quả thối nếu mưa']
      },
      {
        id: 'harvest', name: 'Thu hoạch', months: [10, 11], durationDays: 45,
        description: 'Thu hái chọn lọc (Arabica chín không đều)',
        irrigation: { target: 35, frequency: 'Phục hồi', notes: 'Tươi phục hồi' },
        fertilization: { N: 20, P: 20, K: 20, notes: 'Phục hồi sau thu hoạch' },
        risks: ['Nhân công', 'Chín không đều']
      }
    ]
  }
};

function getCurrentStage(crop, date = new Date()) {
  const month = date.getMonth() + 1;
  const cropData = CROP_STAGES[crop];
  if (!cropData) return null;
  return cropData.stages.find(s => s.months.includes(month)) || cropData.stages[0];
}

module.exports = { CROP_STAGES, getCurrentStage };
