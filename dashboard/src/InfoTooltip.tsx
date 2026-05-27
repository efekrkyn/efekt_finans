import { useState } from 'react';

export function InfoTooltip({ content }: { content: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{position:'relative', display:'inline-block', marginLeft:6}}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(s => !s)}
        style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width:16, height:16, borderRadius:'50%',
          backgroundColor:'rgba(255,255,255,0.1)',
          color:'var(--text-muted)', fontSize:11, fontWeight:700,
          cursor:'help', userSelect:'none'
        }}>?</span>
      {show && (
        <div style={{
          position:'absolute', bottom:'100%', left:'50%', transform:'translateX(-50%)',
          marginBottom:8, padding:12, width:280,
          backgroundColor:'#1c1c1c', color:'#fff',
          borderRadius:8, border:'1px solid var(--accent-primary)',
          fontSize:'0.85rem', lineHeight:1.5, zIndex:1000,
          boxShadow:'0 10px 25px rgba(0,0,0,0.5)',
          fontWeight:400, textAlign:'left', whiteSpace:'normal'
        }}>
          {content}
        </div>
      )}
    </span>
  );
}
