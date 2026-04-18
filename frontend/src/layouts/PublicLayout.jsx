/**
 * @module layouts/PublicLayout
 * @description Public layout with navbar and footer.
 */

import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';

const PublicLayout = () => {
  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <Navbar />
      <main className="pt-[52px]">
        <Outlet />
      </main>
      <footer className="py-8 text-center border-t border-apple-gray-200 bg-white/50">
        <p className="text-[12px] text-apple-gray-400">
          © 2026 BookEase. COMP313 - Group 6 Project.
        </p>
      </footer>
    </div>
  );
};

export default PublicLayout;
