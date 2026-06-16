import { Link, NavLink } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { APP_NAME } from '@relax/shared-utils';
import { SearchBar } from './SearchBar';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/movies', label: 'Movies', end: false },
  { to: '/series', label: 'Series', end: false },
  { to: '/anime', label: 'Anime', end: false },
];

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
        <Link to="/" className="flex items-center gap-2 text-neutral-100">
          <img src="/relax_logo.svg" alt={APP_NAME} className="h-8 w-8" />
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
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={({ isActive }) =>
              [
                'rounded-md p-2 transition',
                isActive
                  ? 'bg-accent-light/20 text-accent-light'
                  : 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100',
              ].join(' ')
            }
          >
            <SettingsIcon className="h-4 w-4" />
          </NavLink>
        </div>
      </div>
    </header>
  );
}
