'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export default function Navigation() {
  const pathname = usePathname();
  return <header className="site-header"><a className="skip-link" href="#main-content">Skip to content</a><nav className="container nav-shell" aria-label="Main navigation">
    <Link className="wordmark" href="/" aria-label="Finomaly home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>finomaly<span className="brand-period">.</span></Link>
    <div className="nav-links">{[{href:'/', label:'Overview'},{href:'/demo',label:'Typing lab'},{href:'/challenge',label:'Two-person test'},{href:'/audit',label:'Audit log'},{href:'/#roadmap',label:'Roadmap'}].map(item=><Link key={item.href} href={item.href} className={pathname===item.href?'nav-link active':'nav-link'} aria-current={pathname===item.href?'page':undefined}>{item.label}</Link>)}</div>
    <span className="nav-note"><span className="status-dot"/>Research prototype</span>
  </nav></header>;
}
