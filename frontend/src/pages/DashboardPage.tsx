import { useEffect, useState } from 'react';
import { api, Account } from '../api/client';

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats] = useState({ credits: 10, todayTasks: 0 });

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-black text-gray-800 mb-6">仪表盘</h2>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="剩余额度" value={`${stats.credits} 次`} color="text-indigo-600" />
        <StatCard label="已绑定账号" value={`${accounts.length} 个`} color="text-green-600" />
        <StatCard label="今日已发布" value={`${stats.todayTasks} 条`} color="text-amber-600" />
      </div>

      {/* 快速入口 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
