import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Drawer, Modal } from "@/components/common";

interface OverlayState { title: string; content: ReactNode }
interface Value {
  openDrawer: (title: string, content: ReactNode) => void;
  openModal: (title: string, content: ReactNode) => void;
  closeModal: () => void;
}
const Context = createContext<Value | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState<OverlayState | null>(null);
  const [modal, setModal] = useState<OverlayState | null>(null);
  const value = useMemo(() => ({
    openDrawer: (title: string, content: ReactNode) => setDrawer({ title, content }),
    openModal: (title: string, content: ReactNode) => setModal({ title, content }),
    closeModal: () => setModal(null)
  }), []);
  return <Context.Provider value={value}>
    {children}
    <Drawer open={!!drawer} title={drawer?.title ?? ""} onClose={() => setDrawer(null)}>{drawer?.content}</Drawer>
    <Modal open={!!modal} title={modal?.title ?? ""} onClose={() => setModal(null)}>{modal?.content}</Modal>
  </Context.Provider>;
}
export function useOverlay() {
  const value = useContext(Context);
  if (!value) throw new Error("OverlayProvider missing");
  return value;
}
