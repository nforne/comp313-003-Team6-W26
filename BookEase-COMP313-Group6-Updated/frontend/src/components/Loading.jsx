/**
 * @module components/Loading
 * @description Apple-style loading spinner component.
 */

import { motion } from 'framer-motion';

const Loading = ({ text = 'Loading...' }) => {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="relative w-10 h-10">
          <motion.div
            className="absolute inset-0 rounded-full border-[3px] border-apple-gray-200"
          />
          <motion.div
            className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-apple-blue"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        </div>
        <p className="text-apple-gray-500 text-[15px] font-medium">{text}</p>
      </motion.div>
    </div>
  );
};

export default Loading;
