import React, { useState, useEffect, useCallback } from 'react';
import { Download, Upload, Plus, Trash2, ChevronDown, ChevronUp, Check, X, Undo2 } from 'lucide-react';

// ===== TYPES =====
type TrainingType = 'push' | 'pull' | 'legs_core' | 'murph' | 'run' | 'dashboard';

type SetEntry = {
  id: string;
  weightKg: number | null;
  reps: number | null;
  notes?: string;
  createdAt: string;
};

type Exercise = {
  id: string;
  name: string;
  variation?: string;
  sets: SetEntry[];
  targetRepHint?: string;
  order: number;
};

type TrainingSession = {
  id: string;
  type: TrainingType;
  date: string;
  completed: boolean;
  startedAt: string;
  endedAt?: string;
  exercises: Exercise[];
  notes?: string;
  location?: string;
  totals?: {
    volumeKg?: number;
    setCount?: number;
  };
  murphData?: {
    rounds: number;
    totalTime?: number;
    isLite?: boolean;
    weightVest?: boolean;
    weightVestKg?: number;
  };
  runData?: {
    distance: number;
    duration: number;
  };
};

type DB = {
  version: number;
  sessions: TrainingSession[];
};

// ===== DATABASE UTILITY =====
const DB_KEY = 'training_tracker_db';

const initDB = (): DB => ({
  version: 1,
  sessions: []
});

const loadDB = (): DB => {
  try {
    const stored = localStorage.getItem(DB_KEY);
    return stored ? JSON.parse(stored) : initDB();
  } catch {
    return initDB();
  }
};

const saveDB = (db: DB): void => {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
};

// ===== HELPERS =====
const LOCATIONS = ['SportsInn', 'Neunkirchen', 'Saarbrücken', 'Kirkel'];

const generateId = () => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const formatWeight = (weight: number | null): string => {
  if (weight === null) return '—';
  return weight.toFixed(1).replace('.0', '');
};

const parseNumber = (value: string): number | null => {
  if (!value || value.trim() === '') return null;
  // Erlaube Komma und Punkt, entferne andere Zeichen
  const cleaned = value.trim().replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
};

const calcVolume = (session: TrainingSession): number => {
  let total = 0;
  session.exercises.forEach(ex => {
    ex.sets.forEach(set => {
      if (set.weightKg !== null && set.reps !== null) {
        total += set.weightKg * set.reps;
      }
    });
  });
  return total;
};

const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleDateString('de-DE', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// ===== PUSH TEMPLATE =====
const PUSH_TEMPLATE: Omit<Exercise, 'id'>[] = [
  { name: 'Overhead Press', sets: [], order: 0 },
  { name: 'Bankdrücken', variation: 'Langhantel', sets: [], order: 1 },
  { name: 'Schrägbankdrücken', variation: 'Langhantel', sets: [], order: 2 },
  { name: 'Military Press', sets: [], order: 3 },
  { name: 'SZ-Frontheben', sets: [], order: 4 },
  { name: 'Dips', sets: [], order: 5 },
  { name: 'SZ-Trizepsdrücken', sets: [], order: 6 }
];

// ===== PULL TEMPLATE =====
const PULL_TEMPLATE: Omit<Exercise, 'id'>[] = [
  { name: 'Klimmzüge', sets: [], order: 0 },
  { name: 'Schweres Rudern', sets: [], order: 1 },
  { name: 'Kreuzheben', sets: [], order: 2 },
  { name: 'Rudern hinten', sets: [], order: 3 },
  { name: 'Bizepscurls', variation: 'SZ-Stange', sets: [], order: 4 },
  { name: 'Shrugs / Nacken', sets: [], order: 5 }
];

// ===== LEGS TEMPLATE =====
const LEGS_TEMPLATE: Omit<Exercise, 'id'>[] = [
  { name: 'Beinpresse', sets: [], order: 0 },
  { name: 'Beinbeuger', sets: [], order: 1 },
  { name: 'Bauch (Schrägbank)', sets: [], order: 2 },
  { name: 'Waden stehend / sitzend', sets: [], order: 3 },
  { name: 'Bauch, quer', sets: [], order: 4 },
  { name: 'Ausfallschritte', sets: [], order: 5 }
];

const getDefaultSetsForExercise = (exerciseName: string): SetEntry[] => {
  const count = ['Bankdrücken', 'Klimmzüge', 'Kreuzheben'].includes(exerciseName) ? 5 : 3;
  return Array.from({ length: count }, () => ({
    id: generateId(),
    weightKg: null,
    reps: null,
    createdAt: new Date().toISOString()
  }));
};

const formatTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const VARIATIONS: Record<string, string[]> = {
  'Bankdrücken': ['Langhantel', 'Brustpresse Maschine', 'Kurzhantel'],
  'Schrägbankdrücken': ['Langhantel', 'Kurzhantel'],
  'Bizepscurls': ['SZ-Stange', 'Kurzhantel', 'Kabelzug'],
  'Waden stehend / sitzend': ['Stehend', 'Sitzend']
};

// ===== MAIN APP =====
export default function TrainingTracker() {
  const [db, setDB] = useState<DB>(loadDB);
  const [activeTab, setActiveTab] = useState<'dashboard' | TrainingType>('dashboard');
  const [activeSession, setActiveSession] = useState<TrainingSession | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    saveDB(db);
  }, [db]);

useEffect(() => {
  const handleScroll = () => {
    if (window.scrollY > 10) {
      setShowHeader(false);
    } else {
      setShowHeader(true);
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  return () => window.removeEventListener('scroll', handleScroll);
}, []);

  const showSnackbar = (message: string, undo?: () => void) => {
    setSnackbar(message);
    if (undo) {
      setUndoAction(() => undo);
      setTimeout(() => setUndoAction(null), 5000);
    }
    setTimeout(() => setSnackbar(null), 5000);
  };

  const createNewSession = () => {
    const template = activeTab === 'push' ? PUSH_TEMPLATE 
                   : activeTab === 'pull' ? PULL_TEMPLATE 
                   : activeTab === 'legs_core' ? LEGS_TEMPLATE 
                   : [];
    
    if (activeTab === 'murph') {
      const murphSession: TrainingSession = {
        id: generateId(),
        type: 'murph',
        date: new Date().toISOString(),
        completed: false,
        startedAt: new Date().toISOString(),
        exercises: [],
        murphData: {
          rounds: 0
        }
      };
      setActiveSession(murphSession);
      setShowHistory(false);
      return;
    }

    if (activeTab === 'run') {
      const runSession: TrainingSession = {
        id: generateId(),
        type: 'run',
        date: new Date().toISOString(),
        completed: false,
        startedAt: new Date().toISOString(),
        exercises: [],
        runData: {
          distance: 0,
          duration: 0
        }
      };
      setActiveSession(runSession);
      setShowHistory(false);
      return;
    }
    
    if (template.length === 0) {
      showSnackbar('Dieser Trainingstyp ist noch nicht implementiert');
      return;
    }
    
    const newSession: TrainingSession = {
      id: generateId(),
      type: activeTab,
      date: new Date().toISOString(),
      completed: false,
      startedAt: new Date().toISOString(),
      exercises: template.map(ex => ({
        ...ex,
        id: generateId(),
        sets: getDefaultSetsForExercise(ex.name)
      }))
    };
    setActiveSession(newSession);
    setShowHistory(false);
  };

  const saveActiveSession = () => {
    if (!activeSession) return;
    
    const completedSession: TrainingSession = {
      ...activeSession,
      completed: true,
      endedAt: new Date().toISOString()
    };

    // Nur für Nicht-Murph und Nicht-Run Trainings die totals berechnen
    if (activeSession.type !== 'murph' && activeSession.type !== 'run') {
      completedSession.totals = {
        volumeKg: calcVolume(activeSession),
        setCount: activeSession.exercises.reduce((sum, ex) => sum + ex.sets.length, 0)
      };
    }

    setDB(prev => ({
      ...prev,
      sessions: [...prev.sessions.filter(s => s.id !== completedSession.id), completedSession]
    }));
    
    setActiveSession(null);
    setShowHistory(true);
    showSnackbar('Training gespeichert!');
  };

  const autoSaveSession = useCallback((session: TrainingSession) => {
    setDB(prev => ({
      ...prev,
      sessions: [...prev.sessions.filter(s => s.id !== session.id), session]
    }));
  }, []);

  const updateSession = (updater: (session: TrainingSession) => TrainingSession) => {
    if (!activeSession) return;
    const updated = updater(activeSession);
    setActiveSession(updated);
    autoSaveSession(updated);
  };

  const findLastSet = (exerciseName: string, variation: string | undefined, setIndex: number): SetEntry | null => {
    const completedSessions = db.sessions
      .filter(s => s.type === activeTab && s.completed && s.id !== activeSession?.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    for (const session of completedSessions) {
      const exercise = session.exercises.find(
        ex => ex.name === exerciseName && ex.variation === variation
      );
      if (exercise && exercise.sets[setIndex]) {
        return exercise.sets[setIndex];
      }
      if (exercise && exercise.sets.length > 0) {
        return exercise.sets[exercise.sets.length - 1];
      }
    }
    return null;
  };

  const exportBackup = () => {
    const dataStr = JSON.stringify(db, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `training-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showSnackbar('Backup erstellt!');
  };

  const importBackup = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string) as DB;
        if (confirm('Bestehende Daten ersetzen? (Abbrechen = Zusammenführen)')) {
          setDB(imported);
          showSnackbar('Backup wiederhergestellt (ersetzt)!');
        } else {
          const merged = { ...imported };
          const existingIds = new Set(db.sessions.map(s => s.id));
          merged.sessions = [
            ...db.sessions,
            ...imported.sessions.filter(s => !existingIds.has(s.id))
          ];
          setDB(merged);
          showSnackbar('Backup zusammengeführt!');
        }
        // Wechsle zum Dashboard um die neuen Daten anzuzeigen
        setActiveTab('dashboard');
      } catch {
        showSnackbar('Fehler beim Importieren!');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const filteredSessions = db.sessions
    .filter(s => s.type === activeTab && s.completed)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);

  const deleteSession = (sessionId: string) => {
    setDB(prev => ({
      ...prev,
      sessions: prev.sessions.filter(s => s.id !== sessionId)
    }));
    showSnackbar('Training gelöscht');
  };

  const bgClass = theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900';
  const cardClass = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputClass = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  const currentVolume = activeSession ? calcVolume(activeSession) : 0;
  const currentSetCount = activeSession ? activeSession.exercises.reduce((sum, ex) => sum + ex.sets.length, 0) : 0;

  return (
    <div className={`min-h-screen ${bgClass} transition-colors`}>
      {/* Header */}
<header className={`sticky top-0 z-50 ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'} border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'} shadow-sm`}>
  <div className="max-w-4xl mx-auto px-4 py-4">
    {/* Dieser Teil bleibt IMMER sichtbar */}
    <div className="flex items-center justify-between mb-4 relative pb-4">
<div className="relative">
  <h1 
    className="text-2xl font-bold cursor-pointer transition-colors"
    onClick={() => setActiveTab('dashboard')}
  >
    Training Tracker
  </h1>
  <p className="absolute top-2 right-8 z-10 text-base italic text-green-500 opacity-60 transform -rotate-12 pointer-events-none">
    byHuwer
  </p>
  {activeSession && (
    <p className="text-sm text-gray-500 mt-1">
      Volumen: {currentVolume.toFixed(0)} kg · {currentSetCount} Sätze
    </p>
  )}
</div>
      <button
        onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      
      {activeSession && (activeSession.type === 'push' || activeSession.type === 'pull' || activeSession.type === 'legs_core') && (
        <div className="absolute left-0 right-0 bottom-2">
          <div className="bg-gray-700 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-green-500 h-full transition-all duration-300"
              style={{ 
                width: `${Math.min(100, (activeSession.exercises.reduce((sum, ex) => sum + ex.sets.filter(s => s.weightKg !== null && s.reps !== null).length, 0) / Math.max(1, activeSession.exercises.reduce((sum, ex) => sum + ex.sets.length, 0))) * 100)}%` 
              }}
            />
          </div>
        </div>
      )}
    </div>
    
    {/* Dieser Teil verschwindet beim Scrollen */}
{showHeader && (
<div>
        {/* Mobile: Custom Dropdown, Desktop: Tabs */}
      <div className="mb-4">
        {/* Mobile Dropdown */}
        <div className="block md:hidden relative">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`w-full px-4 py-3 rounded-lg font-medium text-base border-2 flex items-center justify-between ${
              theme === 'dark' 
                ? 'bg-gray-800 border-gray-700 text-white' 
                : 'bg-white border-gray-300 text-gray-900'
            }`}
          >
            <span>
              {activeTab === 'dashboard' ? '📊 Übersicht' 
               : activeTab === 'push' ? 'Push'
               : activeTab === 'pull' ? 'Pull'
               : activeTab === 'legs_core' ? 'Beine/Bauch'
               : activeTab === 'murph' ? 'Murph'
               : 'Laufen'}
            </span>
            <ChevronDown size={20} className={`transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {mobileMenuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setMobileMenuOpen(false)}
              />
              <div className={`absolute top-full left-0 right-0 mt-2 rounded-lg shadow-xl z-50 overflow-hidden ${
                theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-300'
              }`}>
                {[
                  { value: 'dashboard', label: '📊 Übersicht' },
                  { value: 'push', label: 'Push' },
                  { value: 'pull', label: 'Pull' },
                  { value: 'legs_core', label: 'Beine/Bauch' },
                  { value: 'murph', label: 'Murph' },
                  { value: 'run', label: 'Laufen' }
                ].map(item => (
                  <button
                    key={item.value}
                    onClick={() => {
                      setActiveTab(item.value as TrainingType | 'dashboard');
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full px-4 py-3 text-left font-medium transition-colors ${
                      activeTab === item.value
                        ? 'bg-blue-600 text-white'
                        : theme === 'dark'
                        ? 'hover:bg-gray-700 text-gray-100'
                        : 'hover:bg-gray-100 text-gray-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Desktop Tabs */}
        <div className="hidden md:flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
              activeTab === 'dashboard'
                ? 'bg-blue-600 text-white'
                : theme === 'dark' ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
            }`}
          >
            📊 Übersicht
          </button>
          {(['push', 'pull', 'legs_core', 'murph', 'run'] as TrainingType[]).map(type => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                activeTab === type
                  ? 'bg-blue-600 text-white'
                  : theme === 'dark' ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              {type === 'push' ? 'Push' : type === 'pull' ? 'Pull' : type === 'legs_core' ? 'Beine/Bauch' : type === 'murph' ? 'Murph' : 'Laufen'}
            </button>
          ))}
        </div>
      </div>

{activeTab !== 'dashboard' && !activeSession && (
        <button
          onClick={createNewSession}
          disabled={activeTab !== 'push' && activeTab !== 'pull' && activeTab !== 'legs_core' && activeTab !== 'murph' && activeTab !== 'run'}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
        >
          <Plus size={20} /> Neues Training
        </button>
      )}
      </div>
    )}
  </div>
</header>

      <main className="max-w-4xl mx-auto px-4 py-6">
     {activeTab === 'dashboard' && (
  <DashboardView 
    db={db} 
    theme={theme} 
    onExport={exportBackup}
    onImport={importBackup}
  />
)}

        {activeTab !== 'dashboard' && activeTab !== 'push' && activeTab !== 'pull' && activeTab !== 'legs_core' && activeTab !== 'murph' && activeTab !== 'run' && (
          <div className={`${cardClass} border rounded-lg p-8 text-center`}>
            <p className="text-xl">Dieser Trainingstyp ist noch nicht implementiert.</p>
            <p className="text-gray-500 mt-2">Push-, Pull-, Beine/Bauch-, Murph- und Lauf-Training sind aktuell verfügbar.</p>
          </div>
        )}

        {activeSession && activeSession.type === 'murph' && (
          <MurphView
            session={activeSession}
            updateSession={updateSession}
            onSave={saveActiveSession}
            onCancel={() => {
              setActiveSession(null);
              setShowHistory(true);
            }}
            theme={theme}
          />
        )}
        {activeTab === 'murph' && !activeSession && (
          <HistoryView 
            sessions={filteredSessions} 
            theme={theme} 
            onDelete={deleteSession}
            db={db}
            setDB={setDB}
            showSnackbar={showSnackbar}
          />
        )}

        {activeSession && activeSession.type === 'run' && (
          <RunView
            session={activeSession}
            onSave={(updatedSession: TrainingSession) => {
              setDB(prev => ({
                ...prev,
                sessions: [...prev.sessions.filter(s => s.id !== updatedSession.id), updatedSession]
              }));
              setActiveSession(null);
              setShowHistory(true);
              showSnackbar('Lauf gespeichert!');
            }}
            onCancel={() => {
              setActiveSession(null);
              setShowHistory(true);
            }}
            showSnackbar={showSnackbar}
            theme={theme}
          />
        )}
        {activeTab === 'run' && !activeSession && (
          <HistoryView 
            sessions={filteredSessions} 
            theme={theme} 
            onDelete={deleteSession}
            db={db}
            setDB={setDB}
            showSnackbar={showSnackbar}
          />
        )}

  {(activeTab === 'push' || activeTab === 'pull' || activeTab === 'legs_core') && activeSession && showHistory && activeSession.type === activeTab && (
          <div 
            onClick={() => setShowHistory(false)}
            className={`${cardClass} border-2 border-green-500 rounded-lg p-6 mb-4 cursor-pointer hover:bg-opacity-80 transition-all`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">🟢</span>
                  <h3 className="text-xl font-bold text-green-500">Training läuft...</h3>
                </div>
                <p className="text-sm text-gray-400">
                  Gestartet: {formatDate(activeSession.startedAt)}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  Volumen: {calcVolume(activeSession).toFixed(0)} kg · {activeSession.exercises.reduce((sum, ex) => sum + ex.sets.filter(s => s.weightKg !== null && s.reps !== null).length, 0)} / {activeSession.exercises.reduce((sum, ex) => sum + ex.sets.length, 0)} Sätze
                </p>
              </div>
              <div className="text-3xl">▶️</div>
            </div>
          </div>
        )}

        {(activeTab === 'push' || activeTab === 'pull' || activeTab === 'legs_core') && activeSession && !showHistory && activeSession.type === activeTab && (
          <ActiveSessionView
            session={activeSession}
            updateSession={updateSession}
            onSave={saveActiveSession}
            onCancel={() => {
              setActiveSession(null);
              setShowHistory(true);
            }}
            findLastSet={findLastSet}
            showSnackbar={showSnackbar}
            theme={theme}
          />
        )}

        {(activeTab === 'push' || activeTab === 'pull' || activeTab === 'legs_core') && (
          <HistoryView sessions={filteredSessions} theme={theme} onDelete={deleteSession} db={db} setDB={setDB} showSnackbar={showSnackbar} />
        )}
      </main>

      {/* Snackbar */}
      {snackbar && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
          <span>{snackbar}</span>
          {undoAction && (
            <button
              onClick={() => {
                undoAction();
                setUndoAction(null);
                setSnackbar(null);
              }}
              className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              <Undo2 size={16} /> Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ===== DASHBOARD VIEW =====
function DashboardView({ db, theme, onExport, onImport }: { 
  db: DB; 
  theme: 'light' | 'dark';
  onExport: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const cardClass = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  
  const completedSessions = db.sessions.filter(s => s.completed);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  // Trainingsfrequenz
  const last30Days = completedSessions.filter(s => new Date(s.date) >= thirtyDaysAgo);
  const last7Days = completedSessions.filter(s => new Date(s.date) >= sevenDaysAgo);
  
  // Trainingsvolumen
  const volumeLast30Days = last30Days
    .filter(s => s.totals?.volumeKg)
    .reduce((sum, s) => sum + (s.totals?.volumeKg || 0), 0);
  
  const volumeLast7Days = last7Days
    .filter(s => s.totals?.volumeKg)
    .reduce((sum, s) => sum + (s.totals?.volumeKg || 0), 0);
  
  // Trainingssplit
  const splitCounts: Record<string, number> = {};
  last30Days.forEach(s => {
    const type = s.type === 'push' ? 'Push' 
               : s.type === 'pull' ? 'Pull' 
               : s.type === 'legs_core' ? 'Beine/Bauch' 
               : s.type === 'murph' ? 'Murph' 
               : 'Laufen';
    splitCounts[type] = (splitCounts[type] || 0) + 1;
  });
  
  const total = Object.values(splitCounts).reduce((a, b) => a + b, 0);
  
  // Kalender Heatmap (letzte 90 Tage)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const heatmapData: Record<string, number> = {};
  completedSessions
    .filter(s => new Date(s.date) >= ninetyDaysAgo)
    .forEach(s => {
      const dateKey = new Date(s.date).toISOString().split('T')[0];
      heatmapData[dateKey] = (heatmapData[dateKey] || 0) + 1;
    });
  
  // Hauptübungen Progress
  const mainExercises = ['Bankdrücken', 'Kreuzheben', 'Beinpresse', 'Klimmzüge'];
  const exerciseData: Record<string, Array<{date: string, weight: number}>> = {};
  
  mainExercises.forEach(exerciseName => {
    exerciseData[exerciseName] = [];
    completedSessions
      .filter(s => new Date(s.date) >= thirtyDaysAgo)
      .forEach(session => {
        session.exercises.forEach(ex => {
          if (ex.name === exerciseName) {
            const maxWeight = Math.max(...ex.sets.map(set => set.weightKg || 0));
            if (maxWeight > 0) {
              exerciseData[exerciseName].push({
                date: new Date(session.date).toISOString().split('T')[0],
                weight: maxWeight
              });
            }
          }
        });
      });
  });
  
return (
  <div className="space-y-4">
    {/* Trainingsfrequenz */}
    <div className={`${cardClass} border rounded-lg p-6`}>
      <h3 className="text-xl font-bold mb-4">Trainingsfrequenz</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-blue-500">{last7Days.length}</p>
          <p className="text-sm text-gray-400">Letzte 7 Tage</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-blue-500">{last30Days.length}</p>
          <p className="text-sm text-gray-400">Letzte 30 Tage</p>
        </div>
      </div>
    </div>
    
    {/* Kalender Heatmap */}
    <div className={`${cardClass} border rounded-lg p-6`}>
      <h3 className="text-xl font-bold mb-4">Aktivität (letzte 90 Tage)</h3>
      <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
        {Array.from({ length: 90 }, (_, i) => {
          const date = new Date(now.getTime() - (89 - i) * 24 * 60 * 60 * 1000);
          const dateKey = date.toISOString().split('T')[0];
          const count = heatmapData[dateKey] || 0;
          const intensity = count === 0 ? 'bg-gray-700' 
                         : count === 1 ? 'bg-green-900' 
                         : count === 2 ? 'bg-green-700' 
                         : 'bg-green-500';
          return (
            <div
              key={dateKey}
              className={`aspect-square rounded ${intensity} min-w-[8px] min-h-[8px] touch-manipulation`}
              title={`${dateKey}: ${count} Training${count !== 1 ? 's' : ''}`}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-3 text-xs text-gray-400 justify-center sm:justify-start">
        <span>Weniger</span>
        <div className="w-4 h-4 bg-gray-700 rounded"></div>
        <div className="w-4 h-4 bg-green-900 rounded"></div>
        <div className="w-4 h-4 bg-green-700 rounded"></div>
        <div className="w-4 h-4 bg-green-500 rounded"></div>
        <span>Mehr</span>
      </div>
    </div>
    
    {/* Trainingsvolumen */}
    <div className={`${cardClass} border rounded-lg p-6`}>
      <h3 className="text-xl font-bold mb-4">Trainingsvolumen</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-green-500">
            {(volumeLast7Days / 1000).toFixed(1)}t
          </p>
          <p className="text-sm text-gray-400">Diese Woche</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-green-500">
            {(volumeLast30Days / 1000).toFixed(1)}t
          </p>
          <p className="text-sm text-gray-400">Letzter Monat</p>
        </div>
      </div>
    </div>
    
    {/* Hauptübungen Progress */}
    {mainExercises.some(ex => exerciseData[ex].length > 0) && (
      <div className={`${cardClass} border rounded-lg p-6`}>
        <h3 className="text-xl font-bold mb-4">Hauptübungen (Max-Gewicht)</h3>
        <div className="space-y-6">
          {mainExercises.map(exerciseName => {
            const data = exerciseData[exerciseName];
            if (data.length === 0) return null;
            
            const maxWeight = Math.max(...data.map(d => d.weight));
            const latestWeight = data[data.length - 1]?.weight || 0;
            
            return (
              <div key={exerciseName}>
                <div className="flex justify-between mb-2">
                  <span className="font-semibold">{exerciseName}</span>
                  <span className="text-blue-500 font-bold">{latestWeight} kg</span>
                </div>
                <div className="h-16 flex items-end gap-1">
                  {data.slice(-10).map((point, i) => {
                    const height = (point.weight / maxWeight) * 100;
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-blue-600 rounded-t transition-all hover:bg-blue-500"
                        style={{ height: `${height}%` }}
                        title={`${point.date}: ${point.weight} kg`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}
    
    {/* Trainingssplit */}
    {total > 0 && (
      <div className={`${cardClass} border rounded-lg p-6`}>
        <h3 className="text-xl font-bold mb-4">Trainingssplit (30 Tage)</h3>
        <div className="space-y-3">
          {Object.entries(splitCounts).map(([type, count]) => {
            const percentage = ((count / total) * 100).toFixed(0);
            return (
              <div key={type}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{type}</span>
                  <span>{count}× ({percentage}%)</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}
    
    {/* Datenverwaltung */}
    <div className={`${cardClass} border rounded-lg p-6`}>
      <h3 className="text-xl font-bold mb-4">Datenverwaltung</h3>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onExport}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
        >
          <Download size={20} /> Backup erstellen
        </button>
        <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg cursor-pointer font-medium transition-colors">
          <Upload size={20} /> Backup laden
          <input 
            type="file" 
            accept=".json" 
            onChange={onImport}
            className="hidden" 
          />
        </label>
      </div>
      <p className="text-xs text-gray-400 mt-3 text-center">
        Sichere deine Trainingsdaten regelmäßig oder übertrage sie auf ein anderes Gerät
      </p>
    </div>
    
    {completedSessions.length === 0 && (
      <div className={`${cardClass} border rounded-lg p-8 text-center`}>
        <p className="text-xl mb-2">Noch keine Trainings</p>
        <p className="text-gray-500">Starte dein erstes Training, um Statistiken zu sehen!</p>
      </div>
    )}
  </div>
);
}

// ===== RUN VIEW =====
function RunView({
  session,
  onSave,
  onCancel,
  showSnackbar,
  theme
}: {
  session: TrainingSession;
  onSave: (session: TrainingSession) => void;
  onCancel: () => void;
  showSnackbar: (msg: string) => void;
  theme: 'light' | 'dark';
}) {
  const cardClass = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputClass = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  const [distance, setDistance] = useState<string>(session.runData?.distance?.toString() || '');
  const [durationMinutes, setDurationMinutes] = useState<string>('');
  const [durationSeconds, setDurationSeconds] = useState<string>('');
  const [customDate, setCustomDate] = useState<string>('');
  const [customTime, setCustomTime] = useState<string>('');

  useEffect(() => {
    const now = new Date(session.date);
    setCustomDate(now.toISOString().split('T')[0]);
    setCustomTime(now.toTimeString().slice(0, 5));

    if (session.runData?.duration) {
      const mins = Math.floor(session.runData.duration / 60);
      const secs = session.runData.duration % 60;
      setDurationMinutes(mins.toString());
      setDurationSeconds(secs.toString());
    }
  }, [session.date, session.runData?.duration]);

  const handleSave = () => {
    const dist = parseFloat(distance.replace(',', '.'));
    const mins = parseInt(durationMinutes) || 0;
    const secs = parseInt(durationSeconds) || 0;
    const totalSeconds = mins * 60 + secs;

    if (!dist || dist <= 0) {
      showSnackbar('Bitte gültige Distanz eingeben');
      return;
    }

    if (totalSeconds <= 0) {
      showSnackbar('Bitte gültige Zeit eingeben');
      return;
    }

    const dateTime = new Date(`${customDate}T${customTime}`).toISOString();

    const updatedSession: TrainingSession = {
      ...session,
      date: dateTime,
      startedAt: dateTime,
      endedAt: dateTime,
      completed: true,
      runData: {
        distance: dist,
        duration: totalSeconds
      }
    };

    onSave(updatedSession);
  };

  const pace = () => {
    const dist = parseFloat(distance.replace(',', '.'));
    const mins = parseInt(durationMinutes) || 0;
    const secs = parseInt(durationSeconds) || 0;
    const totalSeconds = mins * 60 + secs;

    if (dist > 0 && totalSeconds > 0) {
      const paceSeconds = totalSeconds / dist;
      const paceMins = Math.floor(paceSeconds / 60);
      const paceSecs = Math.floor(paceSeconds % 60);
      return `${paceMins}:${paceSecs.toString().padStart(2, '0')} min/km`;
    }
    return '—';
  };

  return (
    <div className="space-y-4">
      <div className={`${cardClass} border rounded-lg p-6`}>
        <h2 className="text-3xl font-bold mb-6 text-center">🏃 Lauf-Training</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Datum</label>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className={`w-full px-3 py-2 rounded border ${inputClass}`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Uhrzeit</label>
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              className={`w-full px-3 py-2 rounded border ${inputClass}`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Distanz (km)</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDistance(d => Math.max(0, (parseFloat(d.replace(',', '.')) || 0) - 0.5).toString())}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                −
              </button>
              <input
                type="text"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder="z.B. 5.0"
                className={`flex-1 px-3 py-2 text-center rounded border ${inputClass}`}
              />
              <button
                onClick={() => setDistance(d => ((parseFloat(d.replace(',', '.')) || 0) + 0.5).toString())}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                +
              </button>
              <span className="text-sm font-medium">km</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Zeit</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value.replace(/\D/g, ''))}
                placeholder="Min"
                className={`flex-1 px-3 py-2 text-center rounded border ${inputClass}`}
              />
              <span className="text-xl font-bold">:</span>
              <input
                type="text"
                value={durationSeconds}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  if (parseInt(val) < 60 || val === '') setDurationSeconds(val);
                }}
                placeholder="Sek"
                className={`flex-1 px-3 py-2 text-center rounded border ${inputClass}`}
              />
            </div>
          </div>

          <div className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg p-4 text-center`}>
            <div className="text-sm text-gray-400 mb-1">Pace</div>
            <div className="text-2xl font-bold text-blue-500">{pace()}</div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition-colors"
        >
          ✓ Lauf speichern
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

// ===== MURPH VIEW =====
function MurphView({
  session,
  updateSession,
  onSave,
  onCancel,
  theme
}: {
  session: TrainingSession;
  updateSession: (updater: (s: TrainingSession) => TrainingSession) => void;
  onSave: () => void;
  onCancel: () => void;
  theme: 'light' | 'dark';
}) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(true);
  const [selectedMode, setSelectedMode] = useState<'full' | 'lite' | null>(null);
  const [weightVest, setWeightVest] = useState(false);
  const [vestWeight, setVestWeight] = useState<number>(10);
  const cardClass = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputClass = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  const MURPH_LITE_TIME = 25 * 60; // 25 Minuten in Sekunden
  const isLite = session.murphData?.isLite || false;
  const timeRemaining = isLite ? Math.max(0, MURPH_LITE_TIME - elapsedTime) : 0;

  // Initialisiere Timer mit bereits gespeicherter Zeit
  useEffect(() => {
    if (session.murphData?.totalTime && elapsedTime === 0) {
      setElapsedTime(session.murphData.totalTime);
    }
  }, [session.murphData?.totalTime]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRunning) {
      interval = setInterval(() => {
        setElapsedTime(prev => {
          const newTime = prev + 1;
          // Bei Murph Lite: Stoppe bei 25 Minuten
          if (isLite && newTime >= MURPH_LITE_TIME) {
            setIsRunning(false);
            return MURPH_LITE_TIME;
          }
          // Speichere Zeit kontinuierlich im Session
          updateSession(s => ({
            ...s,
            murphData: {
              ...s.murphData!,
              totalTime: newTime
            }
          }));
          return newTime;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, isLite, MURPH_LITE_TIME, updateSession]);

  const addRound = () => {
    updateSession(s => ({
      ...s,
      murphData: {
        ...s.murphData!,
        rounds: (s.murphData?.rounds || 0) + 1
      }
    }));
  };

  const handleSave = () => {
    updateSession(s => ({
      ...s,
      murphData: {
        ...s.murphData!,
        totalTime: elapsedTime,
        weightVest: weightVest,
        weightVestKg: weightVest ? vestWeight : undefined
      }
    }));
    setIsRunning(false);
    onSave();
  };

  const startMode = (mode: 'full' | 'lite') => {
    setSelectedMode(mode);
    updateSession(s => ({
      ...s,
      murphData: {
        rounds: 0,
        isLite: mode === 'lite',
        weightVest: weightVest,
        weightVestKg: weightVest ? vestWeight : undefined
      }
    }));
    setShowModeSelect(false);
  };

  const rounds = session.murphData?.rounds || 0;
  const progress = isLite ? (rounds / 999) * 100 : (rounds / 20) * 100; // Bei Lite unbegrenzt
  const maxRounds = isLite ? '∞' : 20;

  // Mode Selection Screen
  if (showModeSelect) {
    return (
      <div className="space-y-4">
        <div className={`${cardClass} border rounded-lg p-6`}>
          <h2 className="text-3xl font-bold mb-6 text-center">MURPH Challenge</h2>
          
          <div className="mb-6">
            <label className="flex items-center justify-center gap-3 p-4 bg-blue-900 bg-opacity-30 border border-blue-600 rounded-lg cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={weightVest}
                onChange={(e) => setWeightVest(e.target.checked)}
                className="w-5 h-5"
              />
              <span className="font-bold text-lg">🎒 Gewichtsweste verwenden</span>
            </label>
            
            {weightVest && (
              <div className="flex items-center justify-center gap-3">
                <label className="text-sm font-medium">Gewicht:</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setVestWeight(prev => Math.max(5, prev - 2.5))}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                  >
                    −
                  </button>
                  <input
                    type="text"
                    value={vestWeight}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value.replace(',', '.'));
                      if (!isNaN(val) && val >= 0) setVestWeight(val);
                    }}
                    className={`w-20 px-3 py-2 text-center rounded border ${inputClass}`}
                  />
                  <button
                    onClick={() => setVestWeight(prev => prev + 2.5)}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                  >
                    +
                  </button>
                  <span className="text-sm font-medium">kg</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <button
              onClick={() => startMode('full')}
              className={`${cardClass} border-2 border-blue-600 rounded-lg p-6 hover:bg-blue-900 hover:bg-opacity-20 transition-all`}
            >
              <h3 className="text-2xl font-bold mb-3">💪 MURPH Full</h3>
              <ul className="text-left space-y-2 text-sm text-gray-400">
                <li>• 1,6 km Laufen (Start)</li>
                <li>• <strong className="text-white">20 Runden</strong></li>
                <li className="ml-4">- 5 Klimmzüge</li>
                <li className="ml-4">- 10 Liegestütze</li>
                <li className="ml-4">- 15 Kniebeugen</li>
                <li>• 1,6 km Laufen (Ende)</li>
                <li className="mt-3 text-blue-400">⏱️ Zeit läuft hoch</li>
              </ul>
            </button>

            <button
              onClick={() => startMode('lite')}
              className={`${cardClass} border-2 border-green-600 rounded-lg p-6 hover:bg-green-900 hover:bg-opacity-20 transition-all`}
            >
              <h3 className="text-2xl font-bold mb-3">⚡ MURPH Lite</h3>
              <ul className="text-left space-y-2 text-sm text-gray-400">
                <li>• Kein Laufen</li>
                <li>• <strong className="text-white">Max. Runden in 25 Min</strong></li>
                <li className="ml-4">- 5 Klimmzüge</li>
                <li className="ml-4">- 10 Liegestütze</li>
                <li className="ml-4">- 15 Kniebeugen</li>
                <li className="mt-3 text-green-400">⏱️ Timer: 25:00 → 00:00</li>
              </ul>
            </button>
          </div>
        </div>

        <button
          onClick={onCancel}
          className="w-full py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-bold transition-colors"
        >
          Abbrechen
        </button>
      </div>
    );
  }

  // Workout Screen
  const displayTime = isLite ? timeRemaining : elapsedTime;
  const timeColor = isLite && timeRemaining <= 60 ? 'text-red-500' : 'text-blue-500';

  return (
    <div className="space-y-4">
      <div className={`${cardClass} border rounded-lg p-6 text-center`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-3xl font-bold">
            {isLite ? '⚡ MURPH Lite' : '💪 MURPH Full'}
          </h2>
          {session.murphData?.weightVest && (
            <span className="px-3 py-1 bg-blue-900 border border-blue-600 rounded-full text-sm font-bold">
              🎒 {session.murphData.weightVestKg || 0} kg
            </span>
          )}
        </div>
        
        <div className="mb-6">
          <div className={`text-6xl font-mono font-bold ${timeColor} mb-2`}>
            {formatTime(displayTime)}
          </div>
          {isLite && (
            <div className="text-sm text-gray-400">
              {timeRemaining > 0 ? 'Verbleibende Zeit' : '⏰ Zeit abgelaufen!'}
            </div>
          )}
          <div className="flex gap-2 justify-center mt-4">
            {!isRunning ? (
              <button
                onClick={() => setIsRunning(true)}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition-colors"
              >
                ▶ START
              </button>
            ) : (
              <button
                onClick={() => setIsRunning(false)}
                className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-bold transition-colors"
              >
                ⏸ PAUSE
              </button>
            )}
          </div>
        </div>

        <div className="mb-6">
          <div className="text-gray-500 text-sm mb-2">Fortschritt</div>
          <div className="w-full bg-gray-700 rounded-full h-8 mb-2 overflow-hidden">
            <div 
              className={`${isLite ? 'bg-green-600' : 'bg-blue-600'} h-full transition-all duration-500 flex items-center justify-center text-white font-bold`}
              style={{ width: isLite ? `${Math.min(100, progress)}%` : `${progress}%` }}
            >
              {rounds > 0 && `${rounds}${isLite ? '' : '/20'}`}
            </div>
          </div>
          <div className="text-4xl font-bold mb-4">
            {rounds} {isLite ? 'Runden' : '/ 20 Runden'}
          </div>
          <div className="text-gray-400 text-sm">
            Pro Runde: 5 Klimmzüge • 10 Liegestütze • 15 Kniebeugen
          </div>
        </div>

        <button
          onClick={addRound}
          disabled={!isLite && rounds >= 20}
          className={`w-full py-4 ${isLite ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-bold text-xl transition-colors mb-4`}
        >
          + Runde abgeschlossen
        </button>

        {!isLite && rounds >= 20 && (
          <div className="bg-green-900 border border-green-600 rounded-lg p-4 mb-4">
            <p className="text-green-400 font-bold text-xl">🎉 Alle 20 Runden geschafft!</p>
            <p className="text-green-300 text-sm mt-1">Vergiss nicht die 1,6 km am Ende zu laufen</p>
          </div>
        )}

        {isLite && timeRemaining === 0 && (
          <div className="bg-red-900 border border-red-600 rounded-lg p-4 mb-4">
            <p className="text-red-400 font-bold text-xl">⏰ Zeit abgelaufen!</p>
            <p className="text-red-300 text-sm mt-1">Du hast {rounds} Runden geschafft</p>
          </div>
        )}

        <div className={`${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg p-4 text-left`}>
          <h3 className="font-bold mb-2">📋 {isLite ? 'Murph Lite Workout' : 'Murph Full Workout'}</h3>
          <ul className="text-sm space-y-1 text-gray-400">
            {!isLite && <li>• 1,6 km Laufen (Warm-up)</li>}
            <li>• {isLite ? 'So viele Runden wie möglich in 25 Min' : '20 Runden'}:</li>
            <li className="ml-4">- 5 Klimmzüge</li>
            <li className="ml-4">- 10 Liegestütze</li>
            <li className="ml-4">- 15 Kniebeugen</li>
            {!isLite && <li>• 1,6 km Laufen (Cool-down)</li>}
          </ul>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition-colors"
        >
          ✓ Training beenden
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

// ===== ACTIVE SESSION VIEW =====
function ActiveSessionView({ 
  session, 
  updateSession, 
  onSave, 
  onCancel, 
  findLastSet, 
  showSnackbar,
  theme 
}: { 
  session: TrainingSession;
  updateSession: (updater: (s: TrainingSession) => TrainingSession) => void;
  onSave: () => void;
  onCancel: () => void;
  findLastSet: (name: string, variation: string | undefined, index: number) => SetEntry | null;
  showSnackbar: (msg: string, undo?: () => void) => void;
  theme: 'light' | 'dark';
}) {
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [customLocation, setCustomLocation] = useState('');
  const [showCustomLocation, setShowCustomLocation] = useState(false);
  
  const cardClass = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputClass = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  const addNewExercise = (name: string, variation?: string) => {
    const newExercise: Exercise = {
      id: generateId(),
      name,
      variation,
      sets: [
        { id: generateId(), weightKg: null, reps: null, createdAt: new Date().toISOString() },
        { id: generateId(), weightKg: null, reps: null, createdAt: new Date().toISOString() },
        { id: generateId(), weightKg: null, reps: null, createdAt: new Date().toISOString() }
      ],
      order: session.exercises.length
    };
    
    updateSession(s => ({
      ...s,
      exercises: [...s.exercises, newExercise]
    }));
    
    showSnackbar(`${name} hinzugefügt`);
  };

  const handleLocationChange = (value: string) => {
    if (value === 'custom') {
      setShowCustomLocation(true);
    } else {
      setShowCustomLocation(false);
      updateSession(s => ({ ...s, location: value }));
    }
  };

  const saveCustomLocation = () => {
    if (customLocation.trim()) {
      updateSession(s => ({ ...s, location: customLocation.trim() }));
      setShowCustomLocation(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`${cardClass} border rounded-lg p-4`}>
        <h2 className="text-xl font-bold mb-3">Training läuft...</h2>
        <p className="text-sm text-gray-500 mb-3">Gestartet: {formatDate(session.startedAt)}</p>
        
        <div className="space-y-2">
          <label className="block text-sm font-medium">Trainingsort</label>
          <select
            value={showCustomLocation ? 'custom' : (session.location || '')}
            onChange={(e) => handleLocationChange(e.target.value)}
            className={`w-full px-3 py-2 rounded border ${inputClass}`}
          >
            <option value="">-- Bitte wählen --</option>
            {LOCATIONS.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
            <option value="custom">✏️ Eigener Ort...</option>
          </select>
          
          {showCustomLocation && (
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                placeholder="Eigener Trainingsort..."
                className={`flex-1 px-3 py-2 rounded border ${inputClass}`}
                autoFocus
              />
              <button
                onClick={saveCustomLocation}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
              >
                ✓
              </button>
              <button
                onClick={() => {
                  setShowCustomLocation(false);
                  setCustomLocation('');
                }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
              >
                ✗
              </button>
            </div>
          )}
          
          {session.location && !showCustomLocation && (
            <p className="text-sm text-green-500 mt-1">📍 {session.location}</p>
          )}
        </div>
      </div>

      {session.exercises.map((exercise, exIndex) => (
        <ExerciseCard
          key={exercise.id}
          exercise={exercise}
          exIndex={exIndex}
          updateSession={updateSession}
          findLastSet={findLastSet}
          showSnackbar={showSnackbar}
          theme={theme}
        />
      ))}

      <button
        onClick={() => setShowAddExercise(true)}
        className="w-full py-3 border-2 border-dashed border-blue-600 hover:border-blue-500 rounded-lg text-blue-500 hover:text-blue-400 font-medium transition-colors"
      >
        + Übung hinzufügen
      </button>

      <div className="flex gap-3">
        <button
          onClick={onSave}
          className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition-colors"
        >
          ✓ Training beenden
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors"
        >
          Abbrechen
        </button>
      </div>

      {showAddExercise && (
        <AddExerciseDialog
          onAdd={addNewExercise}
          onClose={() => setShowAddExercise(false)}
          theme={theme}
        />
      )}
    </div>
  );
}

// ===== EXERCISE CARD =====
function ExerciseCard({ 
  exercise, 
  exIndex, 
  updateSession, 
  findLastSet, 
  showSnackbar,
  theme 
}: {
  exercise: Exercise;
  exIndex: number;
  updateSession: (updater: (s: TrainingSession) => TrainingSession) => void;
  findLastSet: (name: string, variation: string | undefined, index: number) => SetEntry | null;
  showSnackbar: (msg: string, undo?: () => void) => void;
  theme: 'light' | 'dark';
}) {
  const [expanded, setExpanded] = useState(true);
  const cardClass = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputClass = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  const updateExercise = (updater: (ex: Exercise) => Exercise) => {
    updateSession(session => ({
      ...session,
      exercises: session.exercises.map((ex, i) => i === exIndex ? updater(ex) : ex)
    }));
  };

  const addSet = () => {
    updateExercise(ex => ({
      ...ex,
      sets: [...ex.sets, { id: generateId(), weightKg: null, reps: null, createdAt: new Date().toISOString() }]
    }));
  };

  const deleteSet = (setIndex: number) => {
    const deletedSet = exercise.sets[setIndex];
    updateExercise(ex => ({
      ...ex,
      sets: ex.sets.filter((_, i) => i !== setIndex)
    }));
    showSnackbar('Satz gelöscht', () => {
      updateExercise(ex => ({
        ...ex,
        sets: [...ex.sets.slice(0, setIndex), deletedSet, ...ex.sets.slice(setIndex)]
      }));
    });
  };

  return (
    <div className={`${cardClass} border rounded-lg p-4`}>
<div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-lg font-bold">{exercise.name}</h3>
          {VARIATIONS[exercise.name] && (
            <select
              value={exercise.variation || ''}
              onChange={(e) => updateExercise(ex => ({ ...ex, variation: e.target.value }))}
              className={`mt-2 px-3 py-1 rounded border ${inputClass} text-sm`}
            >
              {VARIATIONS[exercise.name].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (confirm(`Übung "${exercise.name}" wirklich komplett löschen?`)) {
                updateSession(session => ({
                  ...session,
                  exercises: session.exercises.filter((_, i) => i !== exIndex)
                }));
                showSnackbar('Übung gelöscht');
              }
            }}
            className="p-2 hover:bg-red-900 hover:bg-opacity-30 rounded transition-colors"
            title="Übung löschen"
          >
            <Trash2 size={18} className="text-red-500" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
          >
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2">
          {exercise.sets.map((set, setIndex) => (
            <SetRow
              key={set.id}
              set={set}
              setIndex={setIndex}
              exercise={exercise}
              updateExercise={updateExercise}
              deleteSet={deleteSet}
              findLastSet={findLastSet}
              theme={theme}
            />
          ))}
          <button
            onClick={addSet}
            className="w-full py-3 border-2 border-dashed border-gray-600 hover:border-gray-500 active:bg-gray-700 rounded-lg text-gray-400 hover:text-gray-300 transition-colors text-base font-medium touch-manipulation"
          >
            + Satz hinzufügen
          </button>
        </div>
      )}
    </div>
  );
}

// ===== ADD EXERCISE DIALOG =====
function AddExerciseDialog({ 
  onAdd, 
  onClose, 
  theme 
}: { 
  onAdd: (name: string, variation?: string) => void;
  onClose: () => void;
  theme: 'light' | 'dark';
}) {
  const [exerciseName, setExerciseName] = useState('');
  const [variation, setVariation] = useState('');
  const cardClass = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputClass = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (exerciseName.trim()) {
      onAdd(exerciseName.trim(), variation.trim() || undefined);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`${cardClass} border rounded-lg p-6 max-w-md w-full`}>
        <h3 className="text-xl font-bold mb-4">Übung hinzufügen</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Übungsname *</label>
            <input
              type="text"
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
              placeholder="z.B. Bizeps-Curls"
              className={`w-full px-3 py-2 rounded border ${inputClass}`}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Variation (optional)</label>
            <input
              type="text"
              value={variation}
              onChange={(e) => setVariation(e.target.value)}
              placeholder="z.B. Kurzhantel, SZ-Stange"
              className={`w-full px-3 py-2 rounded border ${inputClass}`}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={!exerciseName.trim()}
              className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              Hinzufügen
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== SET ROW =====
function SetRow({ 
  set, 
  setIndex, 
  exercise, 
  updateExercise, 
  deleteSet, 
  findLastSet,
  theme 
}: {
  set: SetEntry;
  setIndex: number;
  exercise: Exercise;
  updateExercise: (updater: (ex: Exercise) => Exercise) => void;
  deleteSet: (index: number) => void;
  findLastSet: (name: string, variation: string | undefined, index: number) => SetEntry | null;
  theme: 'light' | 'dark';
}) {
  const [weightInput, setWeightInput] = useState<string>('');
  const [repsInput, setRepsInput] = useState<string>('');
  
  const inputClass = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';
  const lastSet = findLastSet(exercise.name, exercise.variation, setIndex);

  useEffect(() => {
    setWeightInput(set.weightKg !== null ? String(set.weightKg).replace('.', ',') : '');
    setRepsInput(set.reps !== null ? String(set.reps) : '');
  }, [set.weightKg, set.reps]);

  const updateSetWeight = (value: string) => {
    setWeightInput(value);
    const parsed = parseNumber(value);
    updateExercise(ex => ({
      ...ex,
      sets: ex.sets.map((s, i) => i === setIndex ? { ...s, weightKg: parsed } : s)
    }));
  };

  const updateSetReps = (value: string) => {
    setRepsInput(value);
    const parsed = value === '' ? null : parseInt(value) || null;
    updateExercise(ex => ({
      ...ex,
      sets: ex.sets.map((s, i) => i === setIndex ? { ...s, reps: parsed } : s)
    }));
  };

  const adjustWeight = (delta: number, multiplier: number = 1) => {
    const current = set.weightKg || 0;
    const newValue = Math.max(0, current + delta * multiplier);
    setWeightInput(String(newValue).replace('.', ','));
    updateExercise(ex => ({
      ...ex,
      sets: ex.sets.map((s, i) => i === setIndex ? { ...s, weightKg: newValue } : s)
    }));
  };

  const adjustReps = (delta: number) => {
    const current = set.reps || 0;
    const newValue = Math.max(0, current + delta);
    setRepsInput(String(newValue));
    updateExercise(ex => ({
      ...ex,
      sets: ex.sets.map((s, i) => i === setIndex ? { ...s, reps: newValue } : s)
    }));
  };

  const applyLast = () => {
    if (lastSet) {
      setWeightInput(lastSet.weightKg !== null ? String(lastSet.weightKg).replace('.', ',') : '');
      setRepsInput(lastSet.reps !== null ? String(lastSet.reps) : '');
      updateExercise(ex => ({
        ...ex,
        sets: ex.sets.map((s, i) => i === setIndex ? { ...s, weightKg: lastSet.weightKg, reps: lastSet.reps } : s)
      }));
    }
  };

  return (
   <div className={`flex flex-col gap-2 p-2 sm:p-3 rounded-lg ${
      set.weightKg !== null && set.reps !== null
        ? theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'  // Vollständig: dunkel
        : theme === 'dark' ? 'bg-gray-700' : 'bg-gray-200'  // Unvollständig: hell
    }`}>
      {/* Erste Zeile: Satz-Nummer + Gewicht + Reps + Löschen */}
      <div className="flex items-center gap-0.5 sm:gap-2">
        <span className="w-5 sm:w-8 text-center font-bold text-gray-500 shrink-0 text-xs sm:text-base">{setIndex + 1}</span>
        
        <div className="flex items-center gap-0.5">
          <button 
            onClick={() => adjustWeight(-2.5)}
            onDoubleClick={(e) => {
              e.preventDefault();
              adjustWeight(-2.5, 2);
            }}
            className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded text-base sm:text-xl font-bold active:bg-gray-500 touch-manipulation shrink-0"
          >−</button>
          <input
            type="text"
            inputMode="decimal"
            value={weightInput}
            onChange={(e) => updateSetWeight(e.target.value)}
            placeholder="kg"
            className={`w-12 sm:w-20 h-7 sm:h-10 px-1 sm:px-2 py-1 sm:py-2 text-center text-xs sm:text-lg rounded border ${inputClass} touch-manipulation`}
          />
          <button 
            onClick={() => adjustWeight(2.5)}
            onDoubleClick={(e) => {
              e.preventDefault();
              adjustWeight(2.5, 2);
            }}
            className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded text-base sm:text-xl font-bold active:bg-gray-500 touch-manipulation shrink-0"
          >+</button>
        </div>

        <span className="text-gray-500 text-sm sm:text-lg shrink-0 px-0.5">×</span>

        <div className="flex items-center gap-0.5">
          <button 
            onClick={() => adjustReps(-1)} 
            className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded text-base sm:text-xl font-bold active:bg-gray-500 touch-manipulation shrink-0"
          >−</button>
          <input
            type="text"
            inputMode="numeric"
            value={repsInput}
            onChange={(e) => updateSetReps(e.target.value)}
            placeholder="Wdh"
            className={`w-12 sm:w-20 h-7 sm:h-10 px-1 sm:px-2 py-1 sm:py-2 text-center text-xs sm:text-lg rounded border ${inputClass} touch-manipulation`}
          />
          <button 
            onClick={() => adjustReps(1)} 
            className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded text-base sm:text-xl font-bold active:bg-gray-500 touch-manipulation shrink-0"
          >+</button>
        </div>

        <button
          onClick={() => deleteSet(setIndex)}
          className="p-1 sm:p-2 hover:bg-red-600 active:bg-red-700 rounded transition-colors touch-manipulation shrink-0 ml-auto"
        >
          <Trash2 size={16} className="sm:hidden" />
          <Trash2 size={18} className="hidden sm:block" />
        </button>
      </div>

      {/* Zweite Zeile: Letzter Satz Info + Übernehmen Button */}
 {lastSet && (
        <div className="flex items-center justify-between gap-2 pl-6 sm:pl-10">
          <span className="text-xs sm:text-sm text-gray-400 truncate">
            Letztes: {formatWeight(lastSet.weightKg)} × {lastSet.reps || '—'}
          </span>
          {set.weightKg === lastSet.weightKg && set.reps === lastSet.reps ? (
            <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-green-800 rounded text-xs sm:text-sm font-small whitespace-nowrap shrink-0 flex items-center gap-1">
              <Check size={14} /> übernommen!
            </div>
          ) : (
            <button
              onClick={applyLast}
              className="px-2 sm:px-3 py-1 sm:py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded text-xs sm:text-sm font-medium transition-colors touch-manipulation whitespace-nowrap shrink-0"
            >
              Übernehmen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ===== HISTORY VIEW =====
function HistoryView({ 
  sessions, 
  theme,
  onDelete,
  db,
  setDB,
  showSnackbar
}: { 
  sessions: TrainingSession[]; 
  theme: 'light' | 'dark';
  onDelete: (sessionId: string) => void;
  db: DB;
  setDB: (updater: (prev: DB) => DB) => void;
  showSnackbar: (msg: string, undo?: () => void) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // ✨ NEU: Edit-Status
  const [editingSession, setEditingSession] = useState<TrainingSession | null>(null);

  const cardClass = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputClass = theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  // 🔧 Edit-Handler
  const handleEdit = (session: TrainingSession) => {
    // tiefer Klon, damit wir im Editor gefahrlos mutieren können
    const clone = JSON.parse(JSON.stringify(session)) as TrainingSession;
    setEditingSession(clone);
    setExpandedId(session.id);
  };

  const updateEditingSession = (updater: (s: TrainingSession) => TrainingSession) => {
    setEditingSession(prev => (prev ? updater(prev) : prev));
  };

  const handleCancelEdit = () => {
    setEditingSession(null);
  };

  const handleSaveEdit = (updated: TrainingSession) => {
    // totals für Kraft-Sessions neu berechnen
    if (updated.type !== 'murph' && updated.type !== 'run') {
      updated.totals = {
        volumeKg: calcVolume(updated),
        setCount: updated.exercises.reduce((sum, ex) => sum + ex.sets.length, 0)
      };
    }

    setDB(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => (s.id === updated.id ? updated : s))
    }));

    setEditingSession(null);
    showSnackbar('Änderungen gespeichert');
  };

  // 🔎 Filter für die Übersicht
  const filteredSessions = sessions.filter(session => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      session.date.toLowerCase().includes(term) ||
      session.exercises.some(ex =>
        ex.name.toLowerCase().includes(term) ||
        (ex.variation || '').toLowerCase().includes(term)
      )
    );
  });

  const handleDelete = (sessionId: string) => {
    onDelete(sessionId);
    setDeleteConfirm(null);
  };

  // 📝 Bearbeitungsansicht
  if (editingSession) {
    return (
      <div className={`${cardClass} border rounded-lg p-4 space-y-4`}>
        <h2 className="text-2xl font-bold mb-2">Training bearbeiten</h2>

        {/* Datum / Uhrzeit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Datum & Zeit</label>
            <input
              type="datetime-local"
              value={new Date(editingSession.date).toISOString().slice(0,16)}
              onChange={(e) => {
                const iso = new Date(e.target.value).toISOString();
                updateEditingSession(s => ({ ...s, date: iso, startedAt: iso }));
              }}
              className={`w-full px-3 py-2 rounded border ${inputClass}`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Ort</label>
            <input
              type="text"
              value={editingSession.location || ''}
              onChange={(e) => updateEditingSession(s => ({ ...s, location: e.target.value }))}
              placeholder="z.B. SportsInn"
              className={`w-full px-3 py-2 rounded border ${inputClass}`}
            />
          </div>
        </div>

        {/* Notizen */}
        <div>
          <label className="block text-sm font-medium mb-1">Notizen</label>
          <textarea
            value={editingSession.notes || ''}
            onChange={(e) => updateEditingSession(s => ({ ...s, notes: e.target.value }))}
            rows={3}
            className={`w-full px-3 py-2 rounded border ${inputClass}`}
          />
        </div>

        {/* Übungen & Sätze */}
        <div className="space-y-4">
          {editingSession.exercises.map((ex, exIdx) => (
            <div key={ex.id} className="border rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={ex.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    updateEditingSession(s => {
                      const clone = { ...s };
                      clone.exercises = clone.exercises.map((e2, i) => i === exIdx ? { ...e2, name } : e2);
                      return clone;
                    });
                  }}
                  className={`flex-1 px-3 py-2 rounded border ${inputClass}`}
                />
                <input
                  type="text"
                  value={ex.variation || ''}
                  onChange={(e) => {
                    const variation = e.target.value || undefined;
                    updateEditingSession(s => {
                      const clone = { ...s };
                      clone.exercises = clone.exercises.map((e2, i) => i === exIdx ? { ...e2, variation } : e2);
                      return clone;
                    });
                  }}
                  placeholder="Variation (optional)"
                  className={`w-full sm:w-48 px-3 py-2 rounded border ${inputClass}`}
                />
              </div>

              
              {/* Sätze */}
<div className="space-y-2">
  {ex.sets.map((set, setIdx) => (
    <div key={set.id} className="grid grid-cols-6 sm:grid-cols-12 gap-2 items-center">
      {/* Gewicht */}
      <div className="col-span-3 sm:col-span-3">
        <input
          type="text"
          value={set.weightKg !== null ? String(set.weightKg).replace('.', ',') : ''}
          onChange={(e) => {
            const parsed = parseNumber(e.target.value);
            updateEditingSession(s => {
              const clone = { ...s };
              clone.exercises[exIdx].sets[setIdx].weightKg = parsed;
              return clone;
            });
          }}
          placeholder="Gewicht"
          className={`w-full px-3 py-2 rounded border ${inputClass}`}
        />
      </div>

      {/* Wdh. */}
      <div className="col-span-2 sm:col-span-2">
        <input
          type="text"
          value={set.reps !== null ? String(set.reps) : ''}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, '');
            const parsed = val === '' ? null : parseInt(val, 10);
            updateEditingSession(s => {
              const clone = { ...s };
              clone.exercises[exIdx].sets[setIdx].reps = parsed;
              return clone;
            });
          }}
          placeholder="Wdh."
          className={`w-full px-3 py-2 rounded border ${inputClass}`}
        />
      </div>

      {/* Löschen-Icon rechts */}
      <div className="col-span-1 sm:col-span-1 flex justify-end">
        <button
          onClick={() => {
            const removed = set;
            updateEditingSession(s => {
              const clone = { ...s };
              clone.exercises[exIdx].sets = clone.exercises[exIdx].sets.filter((_, i) => i !== setIdx);
              return clone;
            });
            showSnackbar('Satz gelöscht', () => {
              updateEditingSession(s => {
                if (!s) return s;
                const clone = { ...s };
                clone.exercises[exIdx].sets = [
                  ...clone.exercises[exIdx].sets.slice(0, setIdx),
                  removed,
                  ...clone.exercises[exIdx].sets.slice(setIdx),
                ];
                return clone;
              });
            });
          }}
          className="p-1 rounded-full text-gray-400 hover:text-red-500"
          title="Satz löschen"
          aria-label="Satz löschen"
        >
          🗑️
        </button>
      </div>
    </div>
  ))}
</div>


              <button
                onClick={() => {
                  updateEditingSession(s => {
                    const clone = { ...s };
                    clone.exercises[exIdx].sets.push({
                      id: generateId(),
                      weightKg: null,
                      reps: null,
                      createdAt: new Date().toISOString(),
                    });
                    return clone;
                  });
                }}
                className="w-full mt-2 py-2 border-2 border-dashed border-gray-600 rounded text-sm"
              >
                + Satz hinzufügen
              </button>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    if (!confirm(`Übung "${ex.name}" löschen?`)) return;
                    updateEditingSession(s => {
                      const clone = { ...s };
                      clone.exercises = clone.exercises.filter((_, i) => i !== exIdx);
                      return clone;
                    });
                  }}
                  className="mt-2 px-3 py-2 rounded bg-red-700 hover:bg-red-800 text-sm"
                >
                  Übung löschen
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Aktionen */}
        <div className="flex gap-3">
          <button
            onClick={() => handleSaveEdit(editingSession)}
            className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold"
          >
            ✓ Änderungen speichern
          </button>
          <button
            onClick={handleCancelEdit}
            className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-bold"
          >
            Abbrechen
          </button>
        </div>
      </div>
    );
  }

  // 📜 Normale Historien-Ansicht
  if (sessions.length === 0) {
    return (
      <div className={`${cardClass} border rounded-lg p-8 text-center`}>
        <p className="text-xl">Noch keine Trainings vorhanden</p>
        <p className="text-gray-500 mt-2">Starte dein erstes Training mit dem „+ Neues Training“ Button</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">Trainingshistorie</h2>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Suche nach Datum oder Übung..."
          className={`w-full sm:w-64 px-4 py-2 rounded-lg border ${inputClass}`}
        />
      </div>

      {filteredSessions.map(session => (
        <div key={session.id} className={`${cardClass} border rounded-lg p-4`}>
          <div className="flex justify-between items-start">
  {/* Linker Bereich: Titel/Meta klickbar */}
  <div
    className="flex-1 cursor-pointer"
    onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
  >
    <div>
      <p className="font-bold text-lg">{formatDate(session.date)}</p>
      {session.type === 'murph'
        ? <p className="text-sm text-gray-400">Murph • Runden: {session.murphData?.rounds ?? 0} • Zeit: {formatTime(session.murphData?.totalTime ?? 0)}</p>
        : session.type === 'run'
          ? <p className="text-sm text-gray-400">Laufen • {session.runData?.distance ?? 0} km in {formatTime(session.runData?.duration ?? 0)}</p>
          : <p className="text-sm text-gray-400">
              {session.exercises.length} Übungen • Volumen: {(session.totals?.volumeKg ?? calcVolume(session)).toFixed(0)} kg
            </p>}
    </div>
  </div>

  {/* Rechter Bereich: Icons oben bündig */}
  <div className="flex gap-3 self-start">
    <button
      onClick={() => handleEdit(session)}
      className="p-1 rounded-full text-gray-400 hover:text-yellow-500"
      title="Training bearbeiten"
      aria-label="Bearbeiten"
    >
      ✏️
    </button>

    {deleteConfirm === session.id ? (
      <>
        <button
          onClick={() => handleDelete(session.id)}
          className="px-2 py-1 rounded text-red-600 hover:text-red-800 text-xs"
        >
          Löschen bestätigen
        </button>
        <button
          onClick={() => setDeleteConfirm(null)}
          className="px-2 py-1 rounded text-gray-500 hover:text-gray-700 text-xs"
        >
          Abbrechen
        </button>
      </>
    ) : (
      <button
        onClick={() => setDeleteConfirm(session.id)}
        className="p-1 rounded-full text-gray-400 hover:text-red-500"
        title="Training löschen"
        aria-label="Löschen"
      >
        🗑️
      </button>
    )}
  </div>
</div>


          {expandedId === session.id && session.type !== 'run' && session.type !== 'murph' && (
            <div className="mt-3">
              {session.exercises.map(ex => (
                <div key={ex.id} className="border rounded-lg p-3 mb-2">
                  <div className="font-semibold">{ex.name}{ex.variation ? ` — ${ex.variation}` : ''}</div>
                  <div className="text-sm text-gray-400">
                    {ex.sets.map((s, i) => (
                      <span key={s.id} className="mr-3">
                        {i + 1}. {formatWeight(s.weightKg)} × {s.reps ?? '—'}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
