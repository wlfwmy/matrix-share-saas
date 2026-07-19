import { useEffect, useState } from 'react';
import { api, Account } from '../api/client';

const PLATFORMS = [
  { id: 'RED', name: '小红书', icon: '📕', needCookie: false, needBrowser: true },
  { id: 'DOUYIN', name: '抖音', icon: '🎵', needCookie: false },
  { id: 'KUAISHOU', name: '快手', icon: '🎬', needCookie: false },
  { id: 'BILIBILI', name: 'B站', icon: '📺', needCookie: false },
  { id: 'WECHAT', name: '微信视频号', icon: '🟢', needCookie: false, needBrowser: true },
];

interface CookieStatus {
  exists: boolean;
  lastTestedAt?: string;
  lastError?: string;
}

const LOGIN_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ok: { label: '已登录', color: 'text-green-600 bg-green-50 border-green-200' },
  need_login: { label: '需要登录', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  expired: { label: '已过期', color: 'text-red-600 bg-red-50 border-red-200' },
  unknown: { label: '未知', color: 'text-gray-400 bg-gray-50 border-gray-200' },
};

export default function BindPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cookieInputs, setCookieInputs] = useState<Record<string, string>>({});
  const [cookieStatuses, setCookieStatuses] = useState<Record<string, CookieStatus>>({});
  const [showInput, setShowInput] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [browserStatuses, setBrowserStatuses] = useState<Record<string, string>>({});
  const [browserLoggingIn, setBrowserLoggingIn] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => {});
    loadCookieStatuses();
    loadBrowserStatuses();
  }, []);

  const loadBrowserStatuses = async () => {
    const statuses: Record<string, string> = {};
    for (const p of PLATFORMS.filter((p) => (p as any).needBrowser)) {
      try {
        const key = p.id === 'RED' ? 'red' : 'wechat';
        const s = await api.get<any>(`/api/platform/${key}/status`);
        statuses[p.id] = s.loginStatus;
      } catch {
        statuses[p.id] = 'unknown';
      }
    }
    setBrowserStatuses(statuses);
  };

  const loadCookieStatuses = async () => {
    const statuses: Record<string, CookieStatus> = {};
    for (const p of PLATFORMS.filter((p) => p.needCookie)) {
      try {
        const s = await api.getCookieStatus(p.id);
        statuses[p.id] = s;
      } catch {
        statuses[p.id] = { exists: false };
      }
    }
    setCookieStatuses(statuses);
  };

  const handleBind = (platform: string) => {
    window.open(`/api/oauth/${platform}/auth-url`, '_blank', 'width=600,height=700');
  };

  const handleUnbind = async (id: string) => {
    if (!confirm('确定解绑？')) return;
    await api.unbindAccount(id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSaveCookie = async (platform: string) => {
    const cookie = cookieInputs[platform];
    if (!cookie?.trim()) return;

    setSaving((prev) => ({ ...prev, [platform]: true }));
    try {
      await api.saveCookie(platform, cookie.trim());
      setMessage({ type: 'success', text: `${PLATFORMS.find((p) => p.id === platform)?.name} Cookie 保存成功` });
      setShowInput((prev) => ({ ...prev, [platform]: false }));
      setCookieInputs((prev) => ({ ...prev, [platform]: '' }));
      await loadCookieStatuses();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '保存失败' });
    } finally {
      setSaving((prev) => ({ ...prev, [platform]: false }));
    }
  };

  const handleDeleteCookie = async (platform: string) => {
    if (!confirm('确定删除 Cookie？')) return;
    try {
      await api.deleteCookie(platform);
      setMessage({ type: 'success', text: 'Cookie 已删除' });
      await loadCookieStatuses();
    } catch {
      setMessage({ type: 'error', text: '删除失败' });
    }
  };

  const isBound = (platform: string) => accounts.some((a) => a.platform === platform);
  const bound = (platform: string) => accounts.find((a) => a.platform === platform);
  const hasCookie = (platform: string) => cookieStatuses[platform]?.exists;

  return (
    <div>
      <h2 className="text-2xl font-black text-gray-800 mb-6">矩阵账号绑定</h2>

      {message && (
        <div
          className={`mb-4 px-4 py-3 rounded-xl text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
          <button className="float-right font-bold" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {PLATFORMS.map((p) => (
          <div
            key={p.id}
            className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{p.icon}</span>
                <div>
                  <p className="font-bold text-gray-800">{p.name}</p>
                  {isBound(p.id) && (
                    <p className="text-xs text-green-600">{bound(p.id)?.nickname}</p>
                  )}
                </div>
              </div>
              {p.needCookie ? (
                <div className="flex gap-2">
                  {hasCookie(p.id) && (
                    <span className="px-2 py-1 text-xs bg-green-50 text-green-600 rounded-lg border border-green-200">
                      Cookie 已配置
                    </span>
                  )}
                  {isBound(p.id) ? (
                    <button
                      onClick={() => handleUnbind(bound(p.id)!.id)}
                      className="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-xl border border-red-100"
                    >
                      解绑
                    </button>
                  ) : null}
                </div>
              ) : (p as any).needBrowser ? (
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded-lg border ${
                      LOGIN_STATUS_LABELS[browserStatuses[p.id]]?.color || 'text-gray-400 bg-gray-50 border-gray-200'
                    }`}
                  >
                    {LOGIN_STATUS_LABELS[browserStatuses[p.id]]?.label || '未知'}
                  </span>
                  {browserStatuses[p.id] !== 'ok' && (
                    <button
                      onClick={async () => {
                        const key = p.id === 'RED' ? 'red' : 'wechat';
                        setBrowserLoggingIn((prev) => ({ ...prev, [p.id]: true }));
                        try {
                          const startApi = p.id === 'RED' ? api.startRedLogin : api.startWeChatLogin;
                          const statusApi = p.id === 'RED' ? api.getRedLoginStatus : api.getWeChatLoginStatus;
                          const r = await startApi();
                          setMessage({ type: 'success', text: r.message });
                          for (let i = 0; i < 120; i++) {
                            await new Promise(r => setTimeout(r, 2000));
                            const s = await statusApi();
                            setBrowserStatuses((prev) => ({ ...prev, [p.id]: s.loginStatus }));
                            if (s.loginStatus === 'ok') break;
                          }
                        } catch (err: any) {
                          setMessage({ type: 'error', text: err.message || '登录失败' });
                        } finally {
                          setBrowserLoggingIn((prev) => ({ ...prev, [p.id]: false }));
                        }
                      }}
                      disabled={browserLoggingIn[p.id]}
                      className="px-3 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-100 disabled:opacity-40"
                    >
                      {browserLoggingIn[p.id] ? '登录中...' : '登录'}
                    </button>
                  )}
                  {!isBound(p.id) && browserStatuses[p.id] === 'ok' && (
                    <button
                      onClick={async () => {
                        try {
                          const bindApi = p.id === 'RED' ? null : api.bindWeChat;
                          if (!bindApi) { setMessage({ type: 'error', text: 'RED 请通过 OAuth 绑定' }); return; }
                          const r = await bindApi();
                          setMessage({ type: 'success', text: `${p.name} 绑定成功: ${r.nickname}` });
                          api.listAccounts().then(setAccounts).catch(() => {});
                        } catch (err: any) {
                          setMessage({ type: 'error', text: err.message || '绑定失败' });
                        }
                      }}
                      className="px-3 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-100"
                    >
                      绑定
                    </button>
                  )}
                  {isBound(p.id) ? (
                    <button
                      onClick={() => handleUnbind(bound(p.id)!.id)}
                      className="px-3 py-0.5 text-xs text-red-500 hover:bg-red-50 rounded-lg border border-red-100"
                    >
                      解绑
                    </button>
                  ) : null}
                </div>
              ) : (
                <div>
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
              )}
            </div>

            {/* Cookie 配置区域（仅 微信视频号） */}
            {p.needCookie && (
              <div className="mt-2 pt-3 border-t border-gray-50">
                {showInput[p.id] ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full h-20 px-3 py-2 text-xs font-mono border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      placeholder="从浏览器复制 Cookie（F12 → Network → 请求头 → Cookie）"
                      value={cookieInputs[p.id] || ''}
                      onChange={(e) =>
                        setCookieInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveCookie(p.id)}
                        disabled={saving[p.id] || !cookieInputs[p.id]?.trim()}
                        className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {saving[p.id] ? '保存中...' : '保存'}
                      </button>
                      <button
                        onClick={() => {
                          setShowInput((prev) => ({ ...prev, [p.id]: false }));
                          setCookieInputs((prev) => ({ ...prev, [p.id]: '' }));
                        }}
                        className="px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50 rounded-xl border border-gray-200"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-400">
                      {hasCookie(p.id) ? (
                        <span className="text-green-600">
                          ✓ 已配置
                          {cookieStatuses[p.id]?.lastTestedAt &&
                            ` · 上次检查 ${new Date(cookieStatuses[p.id].lastTestedAt!).toLocaleDateString('zh-CN')}`}
                          {cookieStatuses[p.id]?.lastError && (
                            <span className="text-amber-600 block mt-0.5">
                              上次错误: {cookieStatuses[p.id].lastError}
                            </span>
                          )}
                        </span>
                      ) : (
                        'Cookie 未配置，数据采集将不可用'
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowInput((prev) => ({ ...prev, [p.id]: true }))}
                        className="px-3 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-100"
                      >
                        {hasCookie(p.id) ? '更新' : '配置 Cookie'}
                      </button>
                      {hasCookie(p.id) && (
                        <>
                          <button
                            onClick={async () => {
                              setMessage(null);
                              try {
                                const r = await api.testCookie(p.id);
                                setMessage({ type: r.success ? 'success' : 'error', text: r.message });
                              } catch (err: any) {
                                setMessage({ type: 'error', text: err.message || '测试失败' });
                              }
                            }}
                            className="px-3 py-1 text-xs text-green-600 hover:bg-green-50 rounded-lg border border-green-200"
                          >
                            测试
                          </button>
                          <button
                            onClick={() => handleDeleteCookie(p.id)}
                            className="px-3 py-1 text-xs text-red-400 hover:bg-red-50 rounded-lg border border-red-100"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* 使用说明 */}
                {!showInput[p.id] && !hasCookie(p.id) && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                      如何获取 Cookie？
                    </summary>
                    <ol className="mt-2 text-xs text-gray-500 space-y-1 list-decimal pl-4">
                      <li>在浏览器中登录 小红书 (www.xiaohongshu.com)</li>
                      <li>按 F12 打开开发者工具</li>
                      <li>切换到 Network（网络）标签</li>
                      <li>刷新页面，点击任意请求</li>
                      <li>在 Request Headers 中找到 <code className="bg-gray-100 px-1 rounded">Cookie</code> 项</li>
                      <li>右键 → Copy Value，粘贴到上方输入框</li>
                    </ol>
                  </details>
                )}
              </div>
            )}

            {/* OAuth 说明（非 cookie / 非 browser 平台 + 未绑定） */}
            {!p.needCookie && !(p as any).needBrowser && !isBound(p.id) && (
              <p className="text-xs text-gray-400 mt-2">
                点击「绑定」后将跳转至平台授权页面
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
