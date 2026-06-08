import React, { useCallback, useEffect, useRef } from "react";
import { Joyride, STATUS, EVENTS, type Step, type EventData } from "react-joyride";

function buildSteps(isAdmin: boolean): Step[] {
  const steps: Step[] = [
    {
      target: "body",
      placement: "center",
      title: "Welcome to MemoLink",
      content: "Your smart AI companion for notes, chat, and planning. Let's take a quick tour of the main features.",
      skipBeacon: true,
    },
    {
      target: "#tour-workspace-selector",
      title: "Workspaces",
      content: "Switch between workspaces here. Each workspace has its own notes, chats, and suggestions — great for separating study topics or projects.",
      skipBeacon: true,
      placement: "right",
    },
    {
      target: "#tour-upload-notes",
      title: "Upload Notes",
      content: "Click to select files or drag and drop documents, PDFs, audio recordings, and more. MemoLink will process and store them as notes.",
      skipBeacon: true,
      placement: "right",
    },
    {
      target: "#tour-notes-section",
      title: "Notes",
      content: "All your notes live here. Click any note to open it in the editor, or use the ⋯ menu to rename or delete.",
      skipBeacon: true,
      placement: "right",
    },
    {
      target: "#tour-chats-section",
      title: "Chat History",
      content: "Your past conversations are listed here. Start a new chat with the + New Chat button, and pick up any previous thread by clicking it.",
      skipBeacon: true,
      placement: "right",
    },
    {
      target: "#tour-recycle-bin",
      title: "Recycle Bin",
      content: "Deleted notes and conversations go here. You can restore or permanently remove them from the Recycle Bin.",
      skipBeacon: true,
      placement: "right",
    },
    {
      target: "#tour-tab-bar",
      title: "Tab Bar & Layout",
      content: "Open chats and notes appear as tabs. Use the layout buttons on the right to switch between stacked, side-by-side, or top/bottom views.",
      skipBeacon: true,
    },
    {
      target: "#tour-chat-input",
      title: "Chat Input",
      content: "Ask MemoLink anything. Type / for slash commands like /summarize, /quiz, /translate, /discussion, and more.",
      skipBeacon: true,
      placement: "top",
    },
    {
      target: "#tour-right-panel",
      title: "Suggestions & Reminders",
      content: "Smart action items and reminders are generated from your notes automatically. You can also add them manually.",
      skipBeacon: true,
      placement: "left",
    },
    {
      target: "#tour-user-menu",
      title: "Your Account",
      content: "Access Settings, Study Mode, MemoGraph, Help, and feedback from your avatar. You can replay this tour anytime from Settings.",
      skipBeacon: true,
      placement: "bottom",
    },
  ];

  if (isAdmin) {
    steps.push({
      target: "#tour-admin-menu",
      title: "Admin Panel",
      content: "As an admin, you can manage users, review feedback, configure feature flags, and view evaluation analytics from here.",
      skipBeacon: true,
      placement: "left",
    });
  }

  return steps;
}

interface OnboardingTourProps {
  run: boolean;
  isAdmin: boolean;
  onOpenUserMenu: () => void;
  onCloseUserMenu: () => void;
  onFinish: () => void;
}

const USER_MENU_STEP_TARGET = "#tour-user-menu";
const ADMIN_STEP_TARGET = "#tour-admin-menu";

export function OnboardingTour({ run, isAdmin, onOpenUserMenu, onCloseUserMenu, onFinish }: OnboardingTourProps) {
  const steps = buildSteps(isAdmin);
  const menuOpenRef = useRef(false);

  useEffect(() => {
    if (!run) {
      if (menuOpenRef.current) {
        onCloseUserMenu();
        menuOpenRef.current = false;
      }
    }
  }, [run]);

  const handleEvent = useCallback((data: EventData) => {
    const { status, type, step } = data;

    // Open user menu before user-menu step and admin step so the elements are in DOM
    if (type === EVENTS.STEP_AFTER) {
      const next = data as any;
      const nextTarget = next?.step?.target;
      if (nextTarget === USER_MENU_STEP_TARGET || nextTarget === ADMIN_STEP_TARGET) {
        onOpenUserMenu();
        menuOpenRef.current = true;
      } else if (menuOpenRef.current && nextTarget !== ADMIN_STEP_TARGET) {
        onCloseUserMenu();
        menuOpenRef.current = false;
      }
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      onCloseUserMenu();
      menuOpenRef.current = false;
      onFinish();
    }
  }, [onFinish, onOpenUserMenu, onCloseUserMenu]);

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      onEvent={handleEvent}
      options={{
        showProgress: true,
        buttons: ["back", "primary", "skip"],
        primaryColor: "#6366f1",
        overlayColor: "rgba(0,0,0,0.55)",
        zIndex: 10000,
        textColor: "#e5e7eb",
        backgroundColor: "#1e1e2a",
      }}
      styles={{
        tooltip: {
          borderRadius: 12,
          border: "1px solid #2a2a38",
          fontSize: 13,
          padding: "16px 20px",
        },
        tooltipTitle: {
          fontSize: 14,
          fontWeight: 600,
          color: "#a5b4fc",
          marginBottom: 6,
        },
        buttonPrimary: {
          borderRadius: 8,
          fontSize: 12,
          padding: "6px 14px",
        },
        buttonBack: {
          color: "#9ca3af",
          fontSize: 12,
        },
        buttonSkip: {
          color: "#6b7280",
          fontSize: 12,
        },
        buttonClose: {
          color: "#6b7280",
        },
      }}
      locale={{
        back: "Back",
        close: "Close",
        last: "Done",
        next: "Next",
        skip: "Skip tour",
      }}
    />
  );
}
