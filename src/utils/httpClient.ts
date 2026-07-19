import axios from 'axios';

// 所有平台 adapter 统一使用这个实例发起请求，避免逐个文件遗漏超时配置
export const http = axios.create({
  timeout: 10000, // 10 秒，平台开放接口正常情况下应该远快于此
});
