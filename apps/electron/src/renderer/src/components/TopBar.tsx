import { Link, NavLink } from 'react-router-dom';
import {
  Home as HomeIcon,
  Bookmark,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { APP_NAME } from '@relax/shared-utils';
import { SearchBar } from './SearchBar';
import logoUrl from '../assets/relax_logo.svg';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/movies', label: 'Movies', end: false },
  { to: '/series', label: 'Series', end: false },
  { to: '/anime', label: 'Anime', end: false },
];

const ICON_NAV: { to: string; label: string; icon: LucideIcon; end: boolean }[] = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/watchlist', label: 'My Watchlist', icon: Bookmark, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
];

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
        <Link to="/" className="flex items-center gap-2 text-neutral-100">
          <img src={logoUrl} alt={APP_NAME} className="h-8 w-8" />
          <span className="text-base font-semibold tracking-tight">{APP_NAME}</span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'rounded-full px-4 py-1.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-accent-light/20 text-accent-light'
                    : 'text-neutral-300 hover:text-neutral-100',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2">
          <SearchBar />
          <div className="ml-1 flex items-center gap-0.5 border-l border-border-subtle/60 pl-2">
            {ICON_NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                title={label}
                className={({ isActive }) =>
                  [
                    'rounded-md p-2 transition',
                    isActive
                      ? 'bg-primary/20 text-primary'
                      : 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100',
                  ].join(' ')
                }
              >
                <Icon className="h-4 w-4" />
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
