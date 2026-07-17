import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: 对接后端 auth
    window.location.href = '/dashboard';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-white">
      <div className="w-full max-w-sm mx-auto p-8">
        <h1 className="text-3xl font-black text-gray-800 mb-2">Matrix Share</h1>
        <p className="text-gray-500 mb-8">多平台矩阵分发控制台</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="email" placeholder="邮箱" value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            required
          />
          <input
            type="password" placeholder="密码" value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            required
          />
          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-all"
          >
            登录
          </button>
        </form>
      </div>
    </div>
  );
}
