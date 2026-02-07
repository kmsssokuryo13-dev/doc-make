import React, { useState, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { APP_STATE_STORAGE_KEY, CONTRACTORS_STORAGE_KEY, SCRIVENERS_STORAGE_KEY } from './constants.js';
import { sanitizeSiteData, sanitizeContractors, sanitizeScriveners } from './sanitize.js';
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx';
import { Editor } from './components/Editor/Editor.jsx';
import { Docs } from './components/Docs/Docs.jsx';

const App = () => {
  const [sites, setSites] = useState([]);
  const [activeSiteId, setActiveSiteId] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [contractors, setContractors] = useState([]);
  const [scriveners, setScriveners] = useState([]);
  const didInitRef = useRef(false);

  useEffect(() => {
    const savedC = localStorage.getItem(CONTRACTORS_STORAGE_KEY);
    const savedS = localStorage.getItem(SCRIVENERS_STORAGE_KEY);
    if (savedC) { try { setContractors(sanitizeContractors(JSON.parse(savedC))); } catch(e) {} }
    if (savedS) { try { setScriveners(sanitizeScriveners(JSON.parse(savedS))); } catch(e) {} }
  }, []);

  useEffect(() => { localStorage.setItem(CONTRACTORS_STORAGE_KEY, JSON.stringify(contractors)); }, [contractors]);
  useEffect(() => { localStorage.setItem(SCRIVENERS_STORAGE_KEY, JSON.stringify(scriveners)); }, [scriveners]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(APP_STATE_STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        const loadedSites = Array.isArray(data?.sites) ? data.sites.map(sanitizeSiteData) : [];
        if (loadedSites.length > 0) {
          setSites(loadedSites);
          const nextActive =
            loadedSites.some(s => s.id === data.activeSiteId)
              ? data.activeSiteId
              : loadedSites[0].id;
          setActiveSiteId(nextActive);
          didInitRef.current = true;
          setHydrated(true);
          return;
        }
      }
    } catch (e) {}

    const sample = sanitizeSiteData({
      name: '令和7年表題登記サンプル案件',
      proposedBuildings: [{
        id: 'b1', address: '砺波市中神三丁目71番地2', houseNum: '101番1', kind: '居宅', struct: '木造合金メッキ鋼板ぶき2階建',
        floorAreas: [{ id: 'f1', floor: '1階', area: '78.66' }, { id: 'f2', floor: '2階', area: '58.32' }], annexes: [],
        registrationCause: "新築",
        registrationDate: { era: "令和", year: "7", month: "1", day: "26", unknown: false }
      }],
      people: [{ id: 'p1', name: '上島 克之', address: '砺波市中神三丁目71番地', share: '1/1', roles: ["申請人"], role: "申請人" }]
    });

    setSites([sample]);
    setActiveSiteId(sample.id);
    didInitRef.current = true;
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!didInitRef.current) return;
    if (!Array.isArray(sites) || sites.length === 0) return;

    try {
      const payload = { activeSiteId, sites };
      localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn("Failed to persist app state:", e);
    }
  }, [sites, activeSiteId]);

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Editor sites={sites} setSites={setSites} activeSiteId={activeSiteId} setActiveSiteId={setActiveSiteId} contractors={contractors} setContractors={setContractors} scriveners={scriveners} setScriveners={setScriveners} />} />
          <Route path="/docs" element={<Docs sites={sites} setSites={setSites} contractors={contractors} scriveners={scriveners} />} />
          <Route path="*" element={<Editor sites={sites} setSites={setSites} activeSiteId={activeSiteId} setActiveSiteId={setActiveSiteId} contractors={contractors} setContractors={setContractors} scriveners={scriveners} setScriveners={setScriveners} />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
};

export default App;
