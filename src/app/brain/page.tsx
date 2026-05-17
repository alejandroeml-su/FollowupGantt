'use client';

/**
 * Brain AI · página raíz con tabs.
 *
 * Fix 2026-05-13 (Edwin · React #482 persistente):
 *   - Cada tab se carga con `next/dynamic({ ssr: false })` y se envuelve
 *     en `<Suspense>`. El AI SDK (`useChat` de `@ai-sdk/react`) llama
 *     internamente al hook `use()` de React 19 sobre promesas; sin un
 *     Suspense ancestor el promise "suspende" en un contexto que React
 *     trata como error #482 ("use() with non-Promise").
 *   - `ssr: false` evita hydration mismatch en componentes que dependen
 *     de browser APIs (fetch streams del SSE, localStorage).
 *   - El `error.tsx` del segmento /brain queda como red de seguridad
 *     extra para cualquier excepción no relacionada a Suspense.
 */

import { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/use-translation';

type Tab = 'knowledge' | 'pm' | 'insights' | 'strategist' | 'writer';

const Loading = () => (
  <div className="flex flex-1 items-center justify-center text-muted-foreground">
    <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    <span className="ml-2 text-sm">Cargando…</span>
  </div>
);

const KnowledgeChat = dynamic(
  () => import('@/components/brain/KnowledgeChat').then((m) => m.KnowledgeChat),
  { ssr: false, loading: Loading },
);
const ProjectManagerAI = dynamic(
  () => import('@/components/brain/ProjectManagerAI').then((m) => m.ProjectManagerAI),
  { ssr: false, loading: Loading },
);
const ProjectInsightsAI = dynamic(
  () => import('@/components/brain/ProjectInsightsAI').then((m) => m.ProjectInsightsAI),
  { ssr: false, loading: Loading },
);
const StrategistAI = dynamic(
  () => import('@/components/brain/StrategistAI').then((m) => m.StrategistAI),
  { ssr: false, loading: Loading },
);
const WriterAI = dynamic(
  () => import('@/components/brain/WriterAI').then((m) => m.WriterAI),
  { ssr: false, loading: Loading },
);

export default function BrainAIPage() {
  // Wave R5E (2026-05-17) — Header bilingüe. Las tabs y el contenido AI
  // siguen en es-MX (deuda registrada) porque el LLM responde según el
  // prompt, no según UI strings.
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('knowledge');

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-[#1e1b4b]/30">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            {t('pages.brain.title')}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('pages.brain.subtitle')}</p>
        </div>
        <div className="flex bg-card rounded-lg p-1 border border-border">
          <TabButton active={activeTab === 'knowledge'} onClick={() => setActiveTab('knowledge')}>
            Knowledge Manager
          </TabButton>
          <TabButton active={activeTab === 'pm'} onClick={() => setActiveTab('pm')}>
            Project Manager AI
          </TabButton>
          <TabButton active={activeTab === 'insights'} onClick={() => setActiveTab('insights')}>
            Project Insights AI
          </TabButton>
          <TabButton active={activeTab === 'strategist'} onClick={() => setActiveTab('strategist')}>
            Strategist AI
          </TabButton>
          <TabButton active={activeTab === 'writer'} onClick={() => setActiveTab('writer')}>
            Writer AI
          </TabButton>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8 relative">
        {/* Background ambient glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="mx-auto max-w-5xl relative z-10 h-full flex flex-col">
          {/* Cada tab queda envuelta en su propio Suspense para aislar el
              fallback del resto. Si `useChat` u otra dependencia llama
              `use(promise)`, el promise se desenvuelve aquí en vez de
              propagar el error #482 al error boundary del segmento. */}
          <Suspense fallback={<Loading />}>
            {activeTab === 'knowledge' && <KnowledgeChat />}
            {activeTab === 'pm' && <ProjectManagerAI />}
            {activeTab === 'insights' && <ProjectInsightsAI />}
            {activeTab === 'strategist' && <StrategistAI />}
            {activeTab === 'writer' && <WriterAI />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
