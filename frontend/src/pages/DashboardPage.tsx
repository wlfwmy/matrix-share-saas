import { useEffect, useState } from 'react';
import { api, Account } from '../api/client';

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

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [trend, setTrend] = useState<Record<string, DailyData[]>>({});
  const [activePlatform, setActivePlatform] = useState<string | null>(null);

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => {});
    api.getAnalytics(7).then(setTrend).catch(() => {});
  }, []);

  const platforms = Object.keys(trend).filter((p) => trend[p]?.length > 0);
  const selected = activePlatform || platforms[0] || '';
  const selectedData = trend[selected] || [];

  // 聚合总数
  const totals = platforms.reduce(
    (acc, p) => {
      const last = trend[p]?.[trend[p].length - 1];
      if (last) {
        acc.views += last.views;
        acc.likes += last.likes;
      }
      return acc;
    },
    { views: 0, likes: 0 },
  );

  return (
    <div>
      <h2 className="text-2xl font-black text-gray-800 mb-6">数据看板</h2>

      {/* 概览卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="已绑定账号" value={`${accounts.length} 个`} color="text-indigo-600" />
        <StatCard label="累计播放" value={formatNum(totals.views)} color="text-blue-600" />
        <StatCard label="累计点赞" value={formatNum(totals.likes)} color="text-pink-600" />
        <StatCard label="已接入平台" value={`${platforms.length} 个`} color="text-green-600" />
      </div>

      {/* 有数据时显示趋势图 */}
      {platforms.length > 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          {/* 平台切换标签 */}
          <div className="flex gap-2 mb-6">
            {platforms.map((p) => (
              <button
                key={p}
                onClick={() => setActivePlatform(p)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selected === p
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {PLATFORM_LABELS[p] || p}
              </button>
            ))}
          </div>

          {/* 简易柱状趋势图 */}
          <div className="space-y-6">
            <MetricChart
              label="播放量"
              data={selectedData}
              color={PLATFORM_COLORS[selected] || '#6366f1'}
              field="views"
            />
            <MetricChart
              label="点赞数"
              data={selectedData}
              color={PLATFORM_COLORS[selected] || '#ec4899'}
              field="likes"
            />
          </div>

          {/* 明细表 */}
          <table className="w-full mt-8 text-sm">
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
              {selectedData.map((d) => {
                const dateStr = new Date(d.date).toLocaleDateString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 text-gray-600">{dateStr}</td>
                    <td className="text-right font-medium">{formatNum(d.views)}</td>
                    <td className="text-right font-medium">{formatNum(d.likes)}</td>
                    <td className="text-right text-gray-500">{formatNum(d.comments)}</td>
                    <td className="text-right text-gray-500">{formatNum(d.shares)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-4xl mb-4">📊</p>
          <p className="text-gray-400 mb-2">暂无数据</p>
          <p className="text-sm text-gray-300">
            绑定平台账号并发布视频后，系统会自动采集各平台数据
          </p>
        </div>
      )}

      {/* 快速入口 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        <QuickLink to="/publish" icon="🚀" title="发布视频" desc="上传视频并分发到多个平台" />
        <QuickLink to="/bind" icon="🔗" title="绑定账号" desc="接入小红书/抖音/快手/B站/微信视频号" />
        <QuickLink to="/billing" icon="💳" title="购买额度" desc="选购套餐，获取更多分发次数" />
        <QuickLink to="/admin/queues" icon="📋" title="任务队列" desc="查看分发任务实时状态" />
      </div>
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

/** 简易柱状图组件 */
function MetricChart({
  label,
  data,
  color,
  field,
}: {
  label: string;
  data: DailyData[];
  color: string;
  field: 'views' | 'likes' | 'comments' | 'shares';
}) {
  const max = Math.max(...data.map((d) => d[field]), 1);
  return (
    <div>
      <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
      <div className="flex items-end gap-1.5 h-24">
        {data.map((d, i) => {
          const val = d[field];
          const h = Math.max((val / max) * 100, val > 0 ? 4 : 0);
          const dateStr = new Date(d.date).toLocaleDateString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
          });
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
