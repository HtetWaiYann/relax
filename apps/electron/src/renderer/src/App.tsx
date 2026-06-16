import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { SearchResults } from './pages/SearchResults';
import { Detail } from './pages/Detail';
import { Browse } from './pages/Browse';
import { Person } from './pages/Person';
import { Settings } from './pages/Settings';
import { Watch } from './pages/Watch';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route
            path="movies"
            element={<Browse kind="movies" title="Movies" subtitle="Browse popular movies on TMDB." />}
          />
          <Route
            path="series"
            element={<Browse kind="series" title="Series" subtitle="Browse popular series on TMDB." />}
          />
          <Route
            path="anime"
            element={
              <Browse
                kind="anime"
                title="Anime"
                subtitle="Japanese animated series ranked by popularity."
              />
            }
          />
          <Route path="search" element={<SearchResults />} />
          <Route path="settings" element={<Settings />} />
          <Route path="title/:mediaType/:id" element={<Detail />} />
          <Route path="person/:id" element={<Person />} />
        </Route>
        <Route path="watch/:infoHash" element={<Watch />} />
      </Routes>
    </HashRouter>
  );
}
