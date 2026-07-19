import { useEffect, useState } from 'react';
import { api, Account, ContentItem, CommentItem } from '../api/client';

interface DailyData {
  id: string;
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  DOUYIN: '抖音',
  BILIBILI: 'B站',
  KUAISHOU: '快手',
  RED: '小红书',
  WECHAT: '微信',
};

const PLATFORM_COLORS: Record<string, string> = {
  DOUYIN: '#1e6df2',
  BILIBILI: '#fb7299',
  KUAISHOU: '#ff6a00',
  RED: '#ff2442',
  WECHAT: '#07c160',
};

const CONTENT_LABEL: Record<string, string> = {
  RED: '笔记',
  DOUYIN: '视频',
  KUAISHOU: '视频',
  BILIBILI: '视频',
  WECHAT: '视频',
};

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [trend, setTrend] = useState<Record<string, DailyData[]>>({});
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [posts, setPosts] = useState<ContentItem[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);

  const linkedPlatforms = [...new Set(accounts.map(a => a.platform))];
  const platform = selectedPlatform || linkedPlatforms[0] || '';
  const platformData = trend[platform] || [];
  const contentLabel = CONTENT_LABEL[platform] || '内容';

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => {});
    api.getAnalytics(30).then(setTrend).catch(() => {});
  }, []);

  // 选中的平台变化时重新拉取内容
  useEffect(() => {
    if (!platform) return;
    setLoadingPosts(true);
    api.getPosts(platform).then(setPosts).catch(() => setPosts([])).finally(() => setLoadingPosts(false));
  }, [platform]);

  useEffect(() => {
    if (!platform) return;
    setLoadingComments(true);
    api.getComments(platform).then(setComments).catch(() => setComments([])).finally(() => setLoadingComments(false));
  }, [platform]);

  const latest = platformData[platformData.length - 1];

  return (
    <div>
      <h2 className="text-2xl font-black text-gray-800 mb-4">数据看板</h2>

      {/* ── 平台选择器（大按钮） ── */}
      <div className="flex gap-3 mb-6">
        {linkedPlatforms.map((p) => {
          const acc = accounts.find(a => a.platform === p);
          return (
            <button
              key={p}
              onClick={() => setSelectedPlatform(p)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm transition-all border-2 ${
                platform === p
                  ? 'bg-gray-900 text-white border-gray-900 shadow-lg'
                  : 'bg-white text-gray-600 border-gray-100 hover:border-gray-200 hover:shadow-sm'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: PLATFORM_COLORS[p] || '#999' }}
              />
              <span>{PLATFORM_LABELS[p] || p}</span>
              {acc && <span className="text-xs opacity-60 ml-1">{acc.nickname}</span>}
            </button>
          );
        })}
        {linkedPlatforms.length === 0 && (
          <p className="text-gray-400 text-sm py-2">暂未绑定任何平台账号</p>
        )}
      </div>

      {!platform ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-4xl mb-4">📊</p>
          <p className="text-gray-400 mb-2">请先绑定平台账号</p>
          <p className="text-sm text-gray-300">
            在「绑定账号」页面接入小红书/抖音/快手/B站/微信视频号后，数据将自动展示在这里
          </p>
        </div>
      ) : (
        <>
          {/* ── 概览卡片（按平台） ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label={`${PLATFORM_LABELS[platform] || platform} 账号`}
              value={`${accounts.filter(a => a.platform === platform).length} 个`}
              color="text-indigo-600"
            />
            <StatCard
              label="最新播放"
              value={latest ? formatNum(latest.views) : '-'}
              color="text-blue-600"
            />
            <StatCard
              label="最新点赞"
              value={latest ? formatNum(latest.likes) : '-'}
              color="text-pink-600"
            />
            <StatCard
              label={`${contentLabel}数`}
              value={String(posts.length)}
              color="text-green-600"
            />
          </div>

          {/* ── 趋势图 ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
            <h3 className="font-bold text-gray-800 mb-4">数据趋势</h3>
            {platformData.length > 0 ? (
              <div className="space-y-6">
                <MetricChart
                  label="播放量"
                  data={platformData}
                  color={PLATFORM_COLORS[platform] || '#6366f1'}
                  field="views"
                />
                <MetricChart
                  label="点赞数"
                  data={platformData}
                  color={PLATFORM_COLORS[platform] || '#ec4899'}
                  field="likes"
                />
                <table className="w-full mt-6 text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left py-2 font-medium">日期</th>
                      <th className="text-right py-2 font-medium">播放</th>
                      <th className="text-right py-2 font-medium">点赞</th>
                      <th className="text-right py-2 font-medium">评论</th>
                      <th className="text-right py-2 font-medium">分享</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platformData.map((d) => (
                      <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 text-gray-600">
                          {new Date(d.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="text-right font-medium">{formatNum(d.views)}</td>
                        <td className="text-right font-medium">{formatNum(d.likes)}</td>
                        <td className="text-right text-gray-500">{formatNum(d.comments)}</td>
                        <td className="text-right text-gray-500">{formatNum(d.shares)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">暂无可用的趋势数据</p>
            )}
          </div>

          {/* ── 内容列表 ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{PLATFORM_LABELS[platform] || platform} {contentLabel}列表</h3>
              <button
                onClick={async () => {
                  setLoadingPosts(true);
                  try {
                    await api.refreshPosts(platform);
                    const p = await api.getPosts(platform);
                    setPosts(p);
                  } catch {}
                  setLoadingPosts(false);
                }}
                disabled={loadingPosts}
                className="px-3 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-100 disabled:opacity-40"
              >
                {loadingPosts ? '刷新中...' : '刷新'}
              </button>
            </div>
            {posts.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left py-2 font-medium">标题</th>
                    <th className="text-right py-2 font-medium">播放</th>
                    <th className="text-right py-2 font-medium">点赞</th>
                    <th className="text-right py-2 font-medium">评论</th>
                    <th className="text-right py-2 font-medium">收藏</th>
                    <th className="text-right py-2 font-medium">分享</th>
                    <th className="text-right py-2 font-medium">日期</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 text-gray-800 max-w-[200px] truncate">{p.title}</td>
                      <td className="text-right font-medium">{p.views}</td>
                      <td className="text-right font-medium">{p.likes}</td>
                      <td className="text-right text-gray-500">{p.comments}</td>
                      <td className="text-right text-gray-500">{p.collects}</td>
                      <td className="text-right text-gray-500">{p.shares}</td>
                      <td className="text-right text-gray-400 text-xs">
                        {p.publishDate ? new Date(p.publishDate).toLocaleDateString('zh-CN') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-gray-400 text-center py-8">
                {loadingPosts ? '加载中...' : `暂无${contentLabel}数据，点击「刷新」从${PLATFORM_LABELS[platform] || platform}拉取`}
              </p>
            )}
          </div>

          {/* ── 评论 ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
            <h3 className="font-bold text-gray-800 mb-4">{PLATFORM_LABELS[platform] || platform} 评论</h3>
            {loadingComments ? (
              <p className="text-gray-400 text-center py-8">加载中...</p>
            ) : comments.length > 0 ? (
              <div className="space-y-3">
                {comments.map((c, i) => (
                  <div key={i} className="border-b border-gray-50 pb-3 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-800">{c.commenter}</span>
                      <span className="text-xs text-gray-400">{c.time}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{c.content}</p>
                    {c.likes > 0 && (
                      <span className="text-xs text-pink-500">❤ {c.likes}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">暂无评论数据</p>
            )}
          </div>

          {/* ── 快速入口 ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
            <QuickLink to="/publish" icon="🚀" title="发布视频" desc="上传视频并分发到多个平台" />
            <QuickLink to="/bind" icon="🔗" title="绑定账号" desc="接入小红书/抖音/快手/B站/微信视频号" />
            <QuickLink to="/billing" icon="💳" title="购买额度" desc="选购套餐，获取更多分发次数" />
            <QuickLink to="/admin/queues" icon="📋" title="任务队列" desc="查看分发任务实时状态" />
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-black ${color}`}>{value}</p>
    </div>
  );
}

function QuickLink({ to, icon, title, desc }: { to: string; icon: string; title: string; desc: string }) {
  return (
    <a
      href={to}
      className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-start gap-4"
    >
      <span className="text-3xl">{icon}</span>
      <div>
        <p className="font-bold text-gray-800">{title}</p>
        <p className="text-sm text-gray-400">{desc}</p>
      </div>
    </a>
  );
}

function MetricChart({
  label, data, color, field,
}: {
  label: string; data: DailyData[]; color: string; field: 'views' | 'likes' | 'comments' | 'shares';
}) {
  const max = Math.max(...data.map((d) => d[field]), 1);
  return (
    <div>
      <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
      <div className="flex items-end gap-1.5 h-24">
        {data.map((d, i) => {
          const val = d[field];
          const h = Math.max((val / max) * 100, val > 0 ? 4 : 0);
          const dateStr = new Date(d.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${dateStr}: ${formatNum(val)}`}>
              <span className="text-[10px] text-gray-400 font-medium">{val > 0 ? formatShort(val) : ''}</span>
              <div
                className="w-full rounded-sm transition-all hover:opacity-80"
                style={{ height: `${h}%`, backgroundColor: color, minHeight: val > 0 ? '4px' : '0' }}
              />
              <span className="text-[10px] text-gray-400">{dateStr.slice(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

function formatShort(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
