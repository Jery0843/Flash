import { useEffect } from 'react';
import { motion } from 'framer-motion';
import './SplashScreen.css';

const LightningBranch = ({ d, colorClass, delay, duration, maxStroke }) => (
  <motion.path
    d={d}
    className={`lightning-path ${colorClass}`}
    stroke="#fff"
    fill="none"
    initial={{ pathLength: 0, opacity: 0 }}
    animate={{ 
      pathLength: [0, 1, 1],
      opacity: [0, 1, 0],
      strokeWidth: [0, maxStroke, 0]
    }}
    transition={{ 
      duration: duration, 
      delay: delay, 
      times: [0, 0.4, 1], 
      ease: "easeOut" 
    }}
  />
);

export function SplashScreen({ onComplete }) {
  // Trigger completion after the animation finishes
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete();
    }, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  // Main vertical crack
  const centerPath = "M500,-100 L470,80 L520,150 L460,250 L530,350 L480,450 L500,550";
  const centerBranch1 = "M470,80 L420,120 L440,160 L380,200";
  const centerBranch2 = "M530,350 L600,320 L640,360 L700,340";

  // Right shooting crack
  const rightPath = "M500,550 L580,510 L540,450 L650,380 L600,300 L750,220 L700,120 L900,50 L850,-50 L1100,-100";
  const rightBranch1 = "M650,380 L720,400 L760,350";

  // Left shooting crack
  const leftPath = "M500,550 L420,590 L460,650 L350,720 L400,800 L250,880 L300,980 L100,1050 L150,1150 L-100,1100";
  const leftBranch1 = "M350,720 L280,700 L240,750";

  return (
    <motion.div 
      className="splash-screen"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5, ease: "easeInOut" } }}
    >
      <div className="splash-content">
        <svg viewBox="0 0 1000 1000" className="lightning-svg" preserveAspectRatio="xMidYMid slice">
          {/* Center Strike */}
          <LightningBranch d={centerPath} colorClass="glow-blue" delay={0} duration={0.8} maxStroke={8} />
          <LightningBranch d={centerBranch1} colorClass="glow-blue" delay={0.1} duration={0.6} maxStroke={3} />
          <LightningBranch d={centerBranch2} colorClass="glow-blue" delay={0.2} duration={0.6} maxStroke={3} />

          {/* Right Split */}
          <LightningBranch d={rightPath} colorClass="glow-purple" delay={0.5} duration={1.2} maxStroke={8} />
          <LightningBranch d={rightBranch1} colorClass="glow-purple" delay={0.7} duration={0.8} maxStroke={3} />

          {/* Left Split */}
          <LightningBranch d={leftPath} colorClass="glow-purple" delay={0.5} duration={1.2} maxStroke={8} />
          <LightningBranch d={leftBranch1} colorClass="glow-purple" delay={0.7} duration={0.8} maxStroke={3} />
          
          {/* Blitz core at intersection */}
          <motion.circle
            cx="500" cy="550" r="10" fill="#fff" className="glow-blue"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 4, 0], opacity: [0, 1, 0] }}
            transition={{ delay: 0.4, duration: 0.6 }}
          />
        </svg>
      </div>
    </motion.div>
  );
}
