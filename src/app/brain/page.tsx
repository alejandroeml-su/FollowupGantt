'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { KnowledgeChat } from '@/components/brain/KnowledgeChat';
import { ProjectManagerAI } from '@/components/brain/ProjectManagerAI';
import { WriterAI } from '@/components/brain/WriterAI';

type Tab = 'knowledge' | 'pm' | 'writer';

export default function BrainAIPage() {
  const [activeTab, setActiveTab] = useState<Tab>('knowledge');

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-[#1e1b4b]/30">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            Avante Brain AI
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Inteligencia Artificial integrada en todo tu entorno de trabajo</p>
        </div>
        <div className="flex bg-card rounded-lg p-1 border border-border">
          <TabButton active={activeTab === 'knowledge'} onClick={() => setActiveTab('knowledge')}>
            Knowledge Manager
          </TabButton>
          <TabButton active={activeTab === 'pm'} onClick={() => setActiveTab('pm')}>
            Project Manager AI
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
          {activeTab === 'knowledge' && <KnowledgeChat />}
          {activeTab === 'pm' && <ProjectManagerAI />}
          {activeTab === 'writer' && <WriterAI />}
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
