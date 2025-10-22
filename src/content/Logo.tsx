import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  animated?: boolean;
}

const Logo: React.FC<LogoProps> = ({ size = 24, className, style, animated = true }) => {
  const logoStyle: React.CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    ...style
  };


  return (
    <div style={logoStyle} className={className}>
      <style>{`
        @keyframes logoFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
        
        @keyframes logoGlow {
          0%, 100% { filter: drop-shadow(0 0 12px rgba(255, 255, 255, 0.4)); }
          50% { filter: drop-shadow(0 0 20px rgba(255, 255, 255, 0.6)); }
        }
      `}</style>
      
      <svg 
        viewBox="0 0 400 300" 
        xmlns="http://www.w3.org/2000/svg"
        style={{ 
          width: '100%', 
          height: '100%',
          animation: animated ? 'logoFloat 4s ease-in-out infinite, logoGlow 3s ease-in-out infinite' : 'none'
        }}
      >
        <defs>
          <linearGradient id={`cloudGradient1-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#0d1421', stopOpacity: 0.95 }} />
            <stop offset="50%" style={{ stopColor: '#1a237e', stopOpacity: 0.85 }} />
            <stop offset="100%" style={{ stopColor: '#3949ab', stopOpacity: 0.8 }} />
          </linearGradient>
          
          <linearGradient id={`cloudGradient2-${size}`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" style={{ stopColor: '#0A84FF', stopOpacity: 0.9 }} />
            <stop offset="50%" style={{ stopColor: '#2196f3', stopOpacity: 0.8 }} />
            <stop offset="100%" style={{ stopColor: '#64b5f6', stopOpacity: 0.7 }} />
          </linearGradient>
          
          <linearGradient id={`cloudGradient3-${size}`} x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#ad1457', stopOpacity: 0.85 }} />
            <stop offset="50%" style={{ stopColor: '#e91e63', stopOpacity: 0.75 }} />
            <stop offset="100%" style={{ stopColor: '#f06292', stopOpacity: 0.65 }} />
          </linearGradient>
          
          <filter id={`dynamicGlow-${size}`}>
            <feMorphology operator="dilate" radius="2"/>
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge> 
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <path 
          d="M60,120 Q90,70 130,90 Q170,50 210,80 Q250,60 270,100 Q280,140 250,160 Q210,180 170,170 Q130,190 90,170 Q50,150 60,120 Z"
          fill={`url(#cloudGradient1-${size})`}
          filter={`url(#dynamicGlow-${size})`}
          style={{ mixBlendMode: 'screen' }}
        />
        
        <path 
          d="M80,140 Q110,90 150,110 Q190,70 230,100 Q270,80 290,120 Q300,160 270,180 Q230,200 190,190 Q150,210 110,190 Q70,170 80,140 Z"
          fill={`url(#cloudGradient2-${size})`}
          filter={`url(#dynamicGlow-${size})`}
          style={{ mixBlendMode: 'screen' }}
        />
        
        <path 
          d="M40,160 Q70,110 110,130 Q150,90 190,120 Q230,100 250,140 Q260,180 230,200 Q190,220 150,210 Q110,230 70,210 Q30,190 40,160 Z"
          fill={`url(#cloudGradient3-${size})`}
          filter={`url(#dynamicGlow-${size})`}
          style={{ mixBlendMode: 'screen' }}
        />
      </svg>
    </div>
  );
};

export default Logo;