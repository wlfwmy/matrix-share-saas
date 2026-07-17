import { useEffect, useState } from 'react';
import { api, Account } from '../api/client';

const PLATFORMS = [
  { id: 'RED', name: '小红书', icon: '📕' },
  { id: 'DOUYIN', name: '抖音', icon: '🎵' },
  { id: 'KUAISHOU', name: '快手', icon: '🎬' },
  { id: 'BILIBILI', name: 'B站', icon: '📺' },
  { id: 'WECHAT', name: '微信视频号', icon: '🟢' },
];

export default function BindPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => {});
  }, []);

  const handleBind = (platform: string) => {
    window.open(`/api/oauth/${platform}/auth-url`, '_blank', 'width=600,height=700');
  };

  const handleUnbind = async (id: string) => {
    if (!confirm('确定解绑？')) return;
    await api.unbindAccount(id);
    setAccounts(prev => prev.filter(a => a.id !== id));
  };

  const isBound = (platform: string) => accounts.some(a => a.platform === platform);
  const bound = (platform: string) => accounts.find(a => a.platform === platform);

  return (
    <div>
      <h2 className="text-2xl font-black text-gray-800 mb-6">矩阵账号绑定</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {PLATFORMS.map(p => (
          <div
            key={p.id}
            className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{p.icon}</span>
              <div>
                <p className="font-bold text-gray-800">{p.name}</p>
                {isBound(p.id) && (
                  <p className="text-xs text-green-600">{bound(p.id)?.nickname}</p>
                )}
              </div>
            </div>
            {isBound(p.id) ? (
              <button
                onClick={() => handleUnbind(bound(p.id)!.id)}
                className="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-xl border border-red-100"
              >
                解绑
              </button>
            ) : (
              <button
                onClick={() => handleBind(p.id)}
                className="px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-xl border border-indigo-100"
              >
                绑定
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
