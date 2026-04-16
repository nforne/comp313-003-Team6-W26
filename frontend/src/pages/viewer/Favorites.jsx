/**
 * @module pages/viewer/Favorites
 * @description User's favorite services page.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import { authAPI } from '../../api/auth.api';
import ServiceCard from '../../components/ServiceCard';
import Loading from '../../components/Loading';

const Favorites = () => {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFavorites();
  }, []);

  const fetchFavorites = async () => {
    try {
      const res = await authAPI.getMe();
      setFavorites(res.data.data.favorites || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight text-apple-gray-900">Favorites</h1>
        <p className="text-[15px] text-apple-gray-500 mt-1">Your saved services</p>
      </motion.div>

      {favorites.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Heart className="w-12 h-12 text-apple-gray-300 mx-auto mb-3" />
          <h3 className="text-[17px] font-semibold text-apple-gray-900 mb-1">No favorites yet</h3>
          <p className="text-[14px] text-apple-gray-500">Save services you're interested in</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {favorites.map((service, i) => (
            <ServiceCard key={service._id || i} service={service} index={i} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Favorites;
