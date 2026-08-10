import React, { ReactNode } from 'react';
import { IssueType } from '../utils/issueBacklog';
import { FlagIssueModal, FlagIssueFormProps } from './FlagIssueModal';

export interface UniversalModalFlagContext {
  getPayload: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  context?: string;
  chainKey?: string;
  dishQuery?: string;
  sourceUrl?: string;
  countryCode?: string;
  firebaseUid?: string;
  sessionId?: string;
  defaultIssueType?: IssueType;
  initialCategory?: 'foodcart' | 'biomarker' | 'database' | 'Home' | 'Other';
}

interface UniversalModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  flagContext?: UniversalModalFlagContext;
  onFlagSuccess?: (issueId: string) => void;
}

export function UniversalModal({
  isOpen,
  onClose,
  title,
  children,
  actions,
  flagContext,
  onFlagSuccess,
}: UniversalModalProps) {
  if (!isOpen) return null;

  if (flagContext) {
    return (
      <FlagIssueModal
        isOpen={isOpen}
        onClose={onClose}
        title={title || 'Flag food analysis issue'}
        getPayload={flagContext.getPayload}
        chainKey={flagContext.chainKey}
        dishQuery={flagContext.dishQuery}
        countryCode={flagContext.countryCode}
        firebaseUid={flagContext.firebaseUid}
        sessionId={flagContext.sessionId}
        initialCategory={flagContext.initialCategory || "foodcart"}
        onSuccess={(id) => {
          if (id && onFlagSuccess) onFlagSuccess(id);
          onClose();
        }}
        onCancel={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-2xl leading-none"
            type="button"
          >
            &times;
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 flex-wrap">
          {actions}
        </div>
      </div>
    </div>
  );
}

export function FlagIssueUniversalModal({
  isOpen,
  onClose,
  title = 'Flag food analysis issue',
  ...formProps
}: Omit<UniversalModalProps, 'children'> & FlagIssueFormProps) {
  if (!isOpen) return null;
  return (
    <FlagIssueModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      {...formProps}
      onSuccess={() => onClose()}
      onCancel={onClose}
    />
  );
}
