import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

type Status = 'loading' | 'success' | 'error';

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const finalize = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state') || '';
      const platform = state.replace(/_.*$/, '').toUpperCase();

      if (!code) {
        setStatus('error');
        setErrorMsg('无效的授权请求（缺少授权码）');
        return;
      }

      try {
        const res = await fetch('/api/oauth/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, platform, state }),
        });

        if (res.ok) {
          setStatus('success');
          setTimeout(() => navigate('/bind', { replace: true }), 2000);
        } else {
          const data = await res.json().catch(() => ({ message: '绑定失败' }));
          throw new Error(data.message || data.error || '授权失败');
        }
      } catch (err: any) {
        setStatus('error');
        setErrorMsg(err.message);
      }
    };

    finalize();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-md max-w-sm w-full p-8 text-center border border-gray-100">
        {status === 'loading' && (
          <div>
            <div className="w-14 h-14 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
            <h2 className="text-lg font-bold text-gray-800 mb-1">正在激活授权</h2>
            <p className="text-sm text-gray-400">正在与平台服务器建立安全连接...</p>
          </div>
        )}

        {status === 'success' && (
          <div>
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <span className="text-green-600 text-2xl">✓</span>
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-1">绑定成功！</h2>
            <p className="text-sm text-gray-400">即将跳转回账号管理...</p>
          </div>
        )}

        {status === 'error' && (
          <div>
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <span className="text-red-500 text-2xl">✗</span>
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-1">授权失败</h2>
            <p className="text-sm text-red-500 mb-5">{errorMsg}</p>
            <button
              onClick={() => navigate('/bind', { replace: true })}
              className="px-6 py-2 bg-gray-800 text-white rounded-xl text-sm hover:bg-gray-900 transition-colors"
            >
              返回管理面板
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
