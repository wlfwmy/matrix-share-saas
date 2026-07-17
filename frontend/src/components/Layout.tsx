import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/dashboard', label: '仪表盘', icon: '📊' },
  { to: '/publish', label: '发布', icon: '🚀' },
  { to: '/bind', label: '账号绑定', icon: '🔗' },
  { to: '/billing', label: '充值', icon: '💳' },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 侧边栏 */}
      <aside className="w-60 bg-white border-r border-gray-200 p-6 hidden md:flex flex-col">
        <h1 className="text-lg font-black text-gray-800 mb-8">Matrix Share</h1>
        <nav className="flex-1 space-y-1">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
                }`
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="text-xs text-gray-400 pt-6 border-t border-gray-100">v1.0.0</div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 p-6 md:p-10 max-w-5xl mx-auto w-full">
        <Outlet />
      </main>
    </div>
  );
}
