import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Props {
  planId: string;
  planName: string;
  price: number;
  onClose: () => void;
}

export default function WeChatPayModal({ planId, planName, price, onClose }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [status, setStatus] = useState('pending');
  const [outTradeNo, setOutTradeNo] = useState('');

  useEffect(() => {
    api.createWechatPayment(planId).then(async (data) => {
      if (data.success) {
        setOutTradeNo(data.outTradeNo);
        const QRCode = await import('qrcode');
        const url = await QRCode.default.toDataURL(data.codeUrl, { width: 280, margin: 2 });
        setQrDataUrl(url);
      }
    });
  }, [planId]);

  useEffect(() => {
    if (!outTradeNo || status !== 'pending') return;
    const timer = setInterval(async () => {
      const data = await api.queryPaymentStatus(outTradeNo);
      if (data.status === 'PAID') {
        setStatus('success');
        clearInterval(timer);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [outTradeNo, status]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full mx-4 text-center">
        <h3 className="text-lg font-bold mb-2">微信支付</h3>
        <p className="text-gray-500 text-sm mb-6">{planName} · ¥{price}</p>

        {qrDataUrl ? (
          <img src={qrDataUrl} className="mx-auto mb-4" alt="支付二维码" />
        ) : (
          <div className="w-[280px] h-[280px] mx-auto mb-4 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400">
            加载中...
          </div>
        )}

        <p className="text-sm text-gray-500 mb-2">请使用微信扫一扫完成支付</p>
        {status === 'success' && (
          <p className="text-green-600 font-bold mb-4">支付成功！</p>
        )}

        <button onClick={onClose}
          className="px-6 py-2.5 bg-gray-100 rounded-xl text-sm hover:bg-gray-200 transition-all">
          关闭
        </button>
      </div>
    </div>
  );
}
