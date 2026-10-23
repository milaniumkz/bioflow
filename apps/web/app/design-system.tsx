"use client";
import { ComponentProps, ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";
export function LabeledInput({
  placeholder,
  ...props
}: ComponentProps<"input">) {
  return (
    <label className="field-control">
      <span>{placeholder}</span>
      <input {...props} placeholder={placeholder} />
    </label>
  );
}
export function LabeledSelect({
  label,
  children,
  ...props
}: ComponentProps<"select"> & { label: string }) {
  return (
    <label className="field-control">
      <span>{label}</span>
      <select {...props}>{children}</select>
    </label>
  );
}
export function RecordDrawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  function close() {
    if (
      !window.dispatchEvent(
        new CustomEvent("bioflow:navigate", {
          cancelable: true,
          detail: { container: ref.current },
        }),
      )
    )
      return;
    ref.current?.close();
    onClose();
  }
  return (
    <dialog
      ref={ref}
      className="record-drawer"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="drawer-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть карточку"
          onClick={close}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
