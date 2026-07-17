import { useState } from 'react';
import WeChatPayModal from '../components/WeChatPayModal';

const PLANS = [
  { id: 'gold', name: '黄金会员', price: 99, credits: 100, desc: '适合个人创作者' },
  { id: 'diamond', name: '钻石会员', price: 299, credits: 500, desc: '适合专业团队' },
];

export default function BillingPage() {
  const [showWechat, setShowWechat] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<null | { id: string; name: string; price: number }>(null);

  const handleAlipay = async (planId: string) => {
    const res = await fetch('/api/v1/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
    const data = await res.json();
    if (data.payUrl) window.location.href = data.payUrl;
  };

  const handleWechatOpen = (plan: { id: string; name: string; price: number }) => {
    setSelectedPlan(plan);
    setShowWechat(true);
  };

  return (
    <div>
      <h2 className="text-2xl font-black text-gray-800 mb-6">选购套餐</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
        {PLANS.map(plan => (
          <div key={plan.id} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h3 className="text-xl font-bold text-gray-800 mb-1">{plan.name}</h3>
            <p className="text-sm text-gray-400 mb-4">{plan.desc}</p>
            <p className="text-4xl font-black text-indigo-600 mb-4">
              ¥{plan.price}
              <span className="text-sm font-normal text-gray-400 ml-1">/{plan.credits}次</span>
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleAlipay(plan.id)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-all"
              >
                支付宝支付
              </button>
              <button
                onClick={() => handleWechatOpen(plan)}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm transition-all"
              >
                微信支付
              </button>
            </div>
          </div>
        ))}
      </div>

      {showWechat && selectedPlan && (
        <WeChatPayModal
          planId={selectedPlan.id}
          planName={selectedPlan.name}
          price={selectedPlan.price}
          onClose={() => setShowWechat(false)}
        />
      )}
    </div>
  );
}
