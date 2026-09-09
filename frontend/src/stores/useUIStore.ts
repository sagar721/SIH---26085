import { create } from 'zustand';

export type ActiveModal = 'none' | 'analytics' | 'provenance' | 'validation' | 'settings' | 'methodology';

export type ViewMode = 'overview' | 'zone';

interface UIState {
  activeModal: ActiveModal;
  setActiveModal: (modal: ActiveModal) => void;
  closeModal: () => void;
  provenanceSearch: string;
  setProvenanceSearch: (query: string) => void;
  selectedProvenanceCategory: string;
  setSelectedProvenanceCategory: (category: string) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeModal: 'none',
  setActiveModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: 'none' }),
  provenanceSearch: '',
  setProvenanceSearch: (query) => set({ provenanceSearch: query }),
  selectedProvenanceCategory: 'ALL',
  setSelectedProvenanceCategory: (category) => set({ selectedProvenanceCategory: category }),
  viewMode: 'overview',
  setViewMode: (mode) => set({ viewMode: mode }),
}));
