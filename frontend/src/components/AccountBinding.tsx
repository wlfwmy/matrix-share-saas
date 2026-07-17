import React, { useState, useEffect } from 'react';

const PLATFORMS = [
  { id: 'RED', name: '小红书', icon: '📕' },
  { id: 'DOUYIN', name: '抖音', icon: '🎵' },
  { id: 'KUAISHOU', name: '快手', icon: '🎬' },
  { id: 'BILIBILI', name: 'B站', icon: '📺' },
  { id: 'WECHAT', name: '微信视频号', icon: '🟢' },
];

export default function AccountBinding() {
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(setAccounts)
      .catch(() => {});
  }, []);

  const handleBind = (platform: string) => {
    window.open(`/api/oauth/${platform}/auth-url`, '_blank', 'width=600,height=700');
  };

  const handleUnbind = async (accountId: string) => {
    if (!confirm('确定解绑该账号？')) return;
    await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
    setAccounts(prev => prev.filter(a => a.id !== accountId));
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h3 className="text-xl font-bold mb-6">矩阵账号管理</h3>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {PLATFORMS.map(p => (
          <button key={p.id} onClick={() => handleBind(p.id)}
            className="p-4 border rounded-2xl text-left hover:bg-gray-50 transition-all">
            <span className="text-2xl mr-3">{p.icon}</span>
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-gray-400 ml-2">绑定账号</span>
          </button>
        ))}
      </div>

      {accounts.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-500 mb-3">已绑定账号</h4>
          <div className="space-y-3">
            {accounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                <div className="flex items-center gap-3">
                  {acc.avatar && <img src={acc.avatar} className="w-10 h-10 rounded-full" alt="" />}
                  <div>
                    <p className="font-medium">{acc.nickname}</p>
                    <p className="text-xs text-gray-400">{acc.platform} · 过期: {new Date(acc.expiresAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <button onClick={() => handleUnbind(acc.id)}
                  className="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-xl">解绑</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
