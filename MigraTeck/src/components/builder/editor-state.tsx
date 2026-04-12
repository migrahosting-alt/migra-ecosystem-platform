"use client";
/**
 * Editor state context for the MigraBuilder site editor.
 * Uses React context + useReducer — no external state library required.
 */
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import type { Viewport } from "@/lib/builder/types";

// ── Types ────────────────────────────────────────────────────────
export interface SiteData {
  id: string;
  name: string;
  slug: string;
  status: string;
  themeJson: Record<string, unknown> | null;
  pages: PageData[];
}

export interface PageData {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  sections: SectionData[];
}

export interface SectionData {
  id: string;
  sectionType: string;
  propsJson: Record<string, unknown>;
  sortOrder: number;
  isVisible: boolean;
}

export interface EditorState {
  site: SiteData | null;
  selectedPageId: string | null;
  selectedSectionId: string | null;
  viewport: Viewport;
  unsavedChanges: boolean;
  saving: boolean;
  publishing: boolean;
}

// ── Actions ──────────────────────────────────────────────────────
type EditorAction =
  | { type: "SET_SITE"; site: SiteData }
  | { type: "SELECT_PAGE"; pageId: string }
  | { type: "SELECT_SECTION"; sectionId: string | null }
  | { type: "SET_VIEWPORT"; viewport: Viewport }
  | { type: "UPDATE_SECTION_PROPS"; sectionId: string; propsJson: Record<string, unknown> }
  | { type: "TOGGLE_SECTION_VISIBILITY"; sectionId: string }
  | { type: "ADD_SECTION"; pageId: string; section: SectionData }
  | { type: "REMOVE_SECTION"; sectionId: string }
  | { type: "REORDER_SECTIONS"; pageId: string; sectionIds: string[] }
  | { type: "ADD_PAGE"; page: PageData }
  | { type: "REMOVE_PAGE"; pageId: string }
  | { type: "SET_SAVING"; saving: boolean }
  | { type: "SET_PUBLISHING"; publishing: boolean }
  | { type: "MARK_SAVED" };

// ── Reducer ──────────────────────────────────────────────────────
function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_SITE":
      return {
        ...state,
        site: action.site,
        selectedPageId: action.site.pages[0]?.id ?? null,
        selectedSectionId: null,
        unsavedChanges: false,
      };

    case "SELECT_PAGE":
      return { ...state, selectedPageId: action.pageId, selectedSectionId: null };

    case "SELECT_SECTION":
      return { ...state, selectedSectionId: action.sectionId };

    case "SET_VIEWPORT":
      return { ...state, viewport: action.viewport };

    case "UPDATE_SECTION_PROPS": {
      if (!state.site) return state;
      const site = {
        ...state.site,
        pages: state.site.pages.map((p) => ({
          ...p,
          sections: p.sections.map((s) =>
            s.id === action.sectionId ? { ...s, propsJson: action.propsJson } : s,
          ),
        })),
      };
      return { ...state, site, unsavedChanges: true };
    }

    case "TOGGLE_SECTION_VISIBILITY": {
      if (!state.site) return state;
      const site = {
        ...state.site,
        pages: state.site.pages.map((p) => ({
          ...p,
          sections: p.sections.map((s) =>
            s.id === action.sectionId ? { ...s, isVisible: !s.isVisible } : s,
          ),
        })),
      };
      return { ...state, site, unsavedChanges: true };
    }

    case "ADD_SECTION": {
      if (!state.site) return state;
      const site = {
        ...state.site,
        pages: state.site.pages.map((p) =>
          p.id === action.pageId ? { ...p, sections: [...p.sections, action.section] } : p,
        ),
      };
      return { ...state, site, unsavedChanges: true, selectedSectionId: action.section.id };
    }

    case "REMOVE_SECTION": {
      if (!state.site) return state;
      const site = {
        ...state.site,
        pages: state.site.pages.map((p) => ({
          ...p,
          sections: p.sections.filter((s) => s.id !== action.sectionId),
        })),
      };
      const selectedSectionId = state.selectedSectionId === action.sectionId ? null : state.selectedSectionId;
      return { ...state, site, unsavedChanges: true, selectedSectionId };
    }

    case "REORDER_SECTIONS": {
      if (!state.site) return state;
      const site = {
        ...state.site,
        pages: state.site.pages.map((p) => {
          if (p.id !== action.pageId) return p;
          const sectionMap = new Map(p.sections.map((s) => [s.id, s]));
          const reordered = action.sectionIds
            .map((id, idx) => {
              const s = sectionMap.get(id);
              return s ? { ...s, sortOrder: idx } : null;
            })
            .filter(Boolean) as SectionData[];
          return { ...p, sections: reordered };
        }),
      };
      return { ...state, site, unsavedChanges: true };
    }

    case "ADD_PAGE": {
      if (!state.site) return state;
      return {
        ...state,
        site: { ...state.site, pages: [...state.site.pages, action.page] },
        selectedPageId: action.page.id,
        selectedSectionId: null,
        unsavedChanges: true,
      };
    }

    case "REMOVE_PAGE": {
      if (!state.site) return state;
      const pages = state.site.pages.filter((p) => p.id !== action.pageId);
      return {
        ...state,
        site: { ...state.site, pages },
        selectedPageId: pages[0]?.id ?? null,
        selectedSectionId: null,
        unsavedChanges: true,
      };
    }

    case "SET_SAVING":
      return { ...state, saving: action.saving };

    case "SET_PUBLISHING":
      return { ...state, publishing: action.publishing };

    case "MARK_SAVED":
      return { ...state, unsavedChanges: false, saving: false };

    default:
      return state;
  }
}

// ── Context ──────────────────────────────────────────────────────
const initialState: EditorState = {
  site: null,
  selectedPageId: null,
  selectedSectionId: null,
  viewport: "desktop",
  unsavedChanges: false,
  saving: false,
  publishing: false,
};

const EditorContext = createContext<EditorState>(initialState);
const EditorDispatchContext = createContext<Dispatch<EditorAction>>(() => {});

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  return (
    <EditorContext.Provider value={state}>
      <EditorDispatchContext.Provider value={dispatch}>
        {children}
      </EditorDispatchContext.Provider>
    </EditorContext.Provider>
  );
}

export function useEditor() {
  return useContext(EditorContext);
}

export function useEditorDispatch() {
  return useContext(EditorDispatchContext);
}

// ── Computed selectors ───────────────────────────────────────────
export function useSelectedPage(): PageData | null {
  const { site, selectedPageId } = useEditor();
  if (!site || !selectedPageId) return null;
  return site.pages.find((p) => p.id === selectedPageId) ?? null;
}

export function useSelectedSection(): SectionData | null {
  const { site, selectedSectionId } = useEditor();
  if (!site || !selectedSectionId) return null;
  for (const p of site.pages) {
    const s = p.sections.find((s) => s.id === selectedSectionId);
    if (s) return s;
  }
  return null;
}
