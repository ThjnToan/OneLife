"""Habit streak logic.

A habit's streak is incremented only on the first completion of the day
for the habit's frequency window, and decremented when a habit is moved
out of ``completed``. This prevents rapid toggle-click inflation of the
streak counter.
"""

from __future__ import annotations

from datetime import date, timedelta

from ..models import Task

_FREQUENCY_DAYS = {
    "daily": 1,
    "weekly": 7,
    "monthly": 30,
}


def _window_size(task: Task) -> int:
    return _FREQUENCY_DAYS.get(task.habit_frequency or "daily", 1)


def update_streak_on_complete(task: Task, today: date | None = None) -> None:
    """Mark a habit completed for ``today`` and update streak accordingly."""
    today = today or date.today()
    window = _window_size(task)
    last = task.last_completed_on

    if last == today:
        # Already counted today; nothing to do.
        return

    if last is None:
        task.streak = 1
    else:
        gap = (today - last).days
        if gap <= window:
            task.streak = (task.streak or 0) + 1
        else:
            # Missed at least one window; reset.
            task.streak = 1

    task.last_completed_on = today


def decrement_streak_on_uncomplete(task: Task, today: date | None = None) -> None:
    """Reverse the streak when a habit is moved out of ``completed``."""
    today = today or date.today()
    if task.last_completed_on == today:
        task.last_completed_on = None
    task.streak = max(0, (task.streak or 0) - 1)


def is_still_in_window(task: Task, today: date | None = None) -> bool:
    """Return True if a habit is still within its expected cadence window."""
    if not task.last_completed_on:
        return False
    today = today or date.today()
    window = _window_size(task)
    return (today - task.last_completed_on).days <= timedelta(days=window).days
