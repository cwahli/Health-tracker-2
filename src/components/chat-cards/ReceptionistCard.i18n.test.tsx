import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReceptionistCard } from './ReceptionistCard';

const handoffMsg = {
  id: 'front_desk_1',
  role: 'assistant',
  agentType: 'front_desk',
  content: '',
  data: {
    agentResult: {
      status: 'ready_for_handoff',
      targetAgent: 'medical',
      handoffPayload: {
        targetAgent: 'medical',
        summaryForAgent: 'Summary text',
        actionableInsights: ['Insight one']
      }
    }
  }
} as any;

describe('ReceptionistCard i18n', () => {
  it('renders English handoff chrome by default', () => {
    const html = renderToStaticMarkup(
      <ReceptionistCard msg={handoffMsg} messages={[]} idx={0} language="en" />
    );
    expect(html).toContain('Specialist Handoff Ready');
    expect(html).toContain('Handoff Formulated');
    expect(html).toContain('Medical Specialist');
  });

  it('renders Indonesian handoff chrome for id', () => {
    const html = renderToStaticMarkup(
      <ReceptionistCard msg={handoffMsg} messages={[]} idx={0} language="id" />
    );
    expect(html).toContain('Handoff Spesialis Siap');
    expect(html).toContain('Handoff Dirumuskan');
    expect(html).toContain('Spesialis Medis');
    expect(html).toContain('Spesialis terhubung');
    expect(html).not.toContain('Specialist Handoff Ready');
  });

  it('renders Indonesian form and panel chrome for id', () => {
    const formMsg = {
      id: 'front_desk_2',
      role: 'assistant',
      agentType: 'front_desk',
      content: '',
      data: {
        agentResult: {
          uiForm: {
            fields: [{ name: 'weight', label: 'Weight', type: 'number', unit: 'kg', required: true }]
          },
          filledRows: [{ key: 'hba1c', value: 5.4, unit: '%', status: 'optimal' }]
        }
      }
    } as any;
    const html = renderToStaticMarkup(
      <ReceptionistCard msg={formMsg} messages={[]} idx={0} language="id" onLogMedical={() => {}} />
    );
    expect(html).toContain('Lengkapi Detail yang Kurang');
    expect(html).toContain('Kirim Detail');
    expect(html).toContain('Panel Biomarker Terekstraksi');
    expect(html).toContain('Sinkronkan ke Log Medis');
    expect(html).toContain('Nama Tes');
  });
});
