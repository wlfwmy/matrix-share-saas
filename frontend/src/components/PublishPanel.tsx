import React, { useEffect, useState } from 'react';
import { api, Account } from '../api/client';

const PLATFORM_LABELS: Record<string, string> = {
  DOUYIN: '抖音', BILIBILI: 'B站', KUAISHOU: '快手', RED: '小红书', WECHAT: '微信视频号',
};

export default function PublishPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => {});
  }, []);

  const toggleAccount = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile || selectedIds.length === 0) return alert('缺少视频或发布渠道！');

    setLoading(true);
    setMsg('获取安全直传签名...');

    try {
      const signRes = await fetch(`/api/oss/upload-url?fileName=${videoFile.name}&fileType=${videoFile.type}`);
      const { uploadUrl, filePublicUrl } = await signRes.json();

      setMsg('正在上传视频至云存储 (不消耗服务器带宽)...');
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', videoFile.type);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => xhr.status === 200 ? resolve(true) : reject();
        xhr.onerror = reject;
        xhr.send(videoFile);
      });

      setMsg('视频上传成功！正在提交后台异步清洗与多路分发...');
      const publishRes = await fetch('/api/publish/matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          videoUrl: filePublicUrl,
          accounts: selectedIds.map(id => {
            const c = accounts.find(item => item.id === id);
            return { id: c?.id, platform: c?.platform, nickname: c?.nickname };
          })
        })
      });

      if (publishRes.ok) {
        setMsg('🚀 矩阵任务分发成功！可前往后台面板查看进度。');
        setVideoFile(null);
        setProgress(0);
      } else {
        setMsg('❌ 任务排队失败');
      }
    } catch (err) {
      setMsg('❌ 链路异常，请检查后端或 OSS CORS 配置');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8 bg-white rounded-2xl shadow-lg border border-gray-100 my-4">
      <h2 className="text-2xl font-black text-gray-800 mb-6 flex items-center">🚀 创建自媒体矩阵发布任务</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-3">1. 勾选分发账号</label>
          <div className="grid grid-cols-2 gap-3">
            {accounts.length === 0 ? (
              <p className="col-span-2 text-sm text-gray-400 py-4 text-center">暂无已绑定的账号，请先到「绑定账号」页面接入平台</p>
            ) : accounts.map(a => {
              const platformLabel = PLATFORM_LABELS[a.platform] || a.platform;
              return (
                <div
                  key={a.id}
                  onClick={() => toggleAccount(a.id)}
                  className={`cursor-pointer p-4 border rounded-xl flex items-center justify-between transition-all ${
                    selectedIds.includes(a.id) ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/10' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <span className="text-sm font-semibold text-gray-700">{a.nickname}</span>
                    <span className="text-xs text-gray-400 ml-2">{platformLabel}</span>
                  </div>
                  <input type="checkbox" checked={selectedIds.includes(a.id)} onChange={() => {}} className="rounded text-indigo-600" />
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">2. 视频文件</label>
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-indigo-500 transition-all">
            <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} className="hidden" id="video-file" />
            <label htmlFor="video-file" className="cursor-pointer text-gray-500">
              {videoFile ? <span className="text-indigo-600 font-bold">已挂载: {videoFile.name}</span> : '点击或拖拽视频到此处'}
            </label>
          </div>
          {progress > 0 && (
            <div className="mt-3">
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-indigo-600 h-2 rounded-full transition-all duration-150" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="text-xs text-right text-gray-400 mt-1">直传进度: {progress}%</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="写一个引人瞩目的标题..." className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" required />
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="视频详细介绍 & 话题 Tag（例：#AI短剧 #去重）..." rows={4} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
        </div>

        {msg && <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600 border border-gray-100">{msg}</div>}

        <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold py-4 rounded-xl transition-all shadow-md">
          {loading ? '分发管道处理中...' : '一键矩阵去重发布'}
        </button>
      </form>
    </div>
  );
}
