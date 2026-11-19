"use client";
import { useEffect, useRef, useState } from "react";
import { Menu, X, Bell, LogOut, UserRoundX } from "lucide-react";
import "./collection-navigation.css";
type Props = {
  items: string[][];
  selected: string;
  unread: number;
  owner: boolean;
  onSelect: (id: string) => void;
  onSignOut: () => Promise<void>;
};
export function CollectionNavigation({
  items,
  selected,
  unread,
  owner,
  onSelect,
  onSignOut,
}: Props) {
  const drawer = useRef<HTMLDialogElement>(null),
    [open, setOpen] = useState(false);
  const close = () => drawer.current?.close();
  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, [open]);
  useEffect(() => {
    const back = (event: Event) => {
      if (drawer.current?.open) {
        event.preventDefault();
        drawer.current.close();
      }
    };
    window.addEventListener("collection:back", back, true);
    return () => window.removeEventListener("collection:back", back, true);
  }, []);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width:701px)");
    const changed = () => {
      if (desktop.matches) drawer.current?.close();
    };
    desktop.addEventListener("change", changed);
    return () => desktop.removeEventListener("change", changed);
  }, []);
  function choose(id: string) {
    close();
    onSelect(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function show() {
    drawer.current?.showModal();
    setOpen(true);
  }
  const content = (
    <>
      <div className="c-menu-brand">
        <span className="collection-wordmark">collection</span>
        <button
          type="button"
          className="c-drawer-close"
          onClick={close}
          aria-label="Закрыть меню"
        >
          <X size={22} />
        </button>
      </div>
      <nav aria-label="Разделы Collection">
        {items.map(([id, title]) => (
          <button
            type="button"
            key={id}
            className={selected === id ? "active" : ""}
            aria-current={selected === id ? "page" : undefined}
            onClick={() => choose(id)}
          >
            <span>{title}</span>
            {id === "notifications" && unread ? <b>{unread}</b> : null}
          </button>
        ))}
      </nav>
      <div className="c-menu-bottom">
        {owner ? <a href="/collection/admin">Администрирование</a> : null}
        <button type="button" onClick={() => choose("account-deletion")}>
          <UserRoundX size={17} />
          Удалить аккаунт
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            void onSignOut();
          }}
        >
          <LogOut size={17} /> Выйти из аккаунта
        </button>
      </div>
    </>
  );
  return (
    <>
      <header className="c-mobilebar">
        <button
          type="button"
          aria-label="Открыть меню"
          aria-expanded={open}
          onClick={show}
        >
          <Menu size={24} />
        </button>
        <span className="collection-wordmark">collection</span>
        <button
          type="button"
          aria-label="Открыть уведомления"
          onClick={() => choose("notifications")}
        >
          <Bell size={21} />
          {unread ? <b>{unread}</b> : null}
        </button>
      </header>
      <aside className="c-sidebar c-desktop-sidebar">{content}</aside>
      <dialog
        ref={drawer}
        className="c-mobile-drawer"
        aria-label="Боковое меню"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <aside className="c-drawer-panel">{content}</aside>
      </dialog>
    </>
  );
}
