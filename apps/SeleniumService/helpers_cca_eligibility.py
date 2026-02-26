import os
import time
import asyncio
from typing import Dict, Any
from selenium.common.exceptions import WebDriverException

from selenium_CCA_eligibilityCheckWorker import AutomationCCAEligibilityCheck
from cca_browser_manager import get_browser_manager

sessions: Dict[str, Dict[str, Any]] = {}


def make_session_entry() -> str:
    import uuid
    sid = str(uuid.uuid4())
    sessions[sid] = {
        "status": "created",
        "created_at": time.time(),
        "last_activity": time.time(),
        "bot": None,
        "driver": None,
        "result": None,
        "message": None,
        "type": None,
    }
    return sid


async def cleanup_session(sid: str, message: str | None = None):
    s = sessions.get(sid)
    if not s:
        return
    try:
        if s.get("status") not in ("completed", "error", "not_found"):
            s["status"] = "error"
        if message:
            s["message"] = message
    finally:
        sessions.pop(sid, None)


async def _remove_session_later(sid: str, delay: int = 30):
    await asyncio.sleep(delay)
    await cleanup_session(sid)


def _close_browser(bot):
    try:
        bm = get_browser_manager()
        try:
            bm.save_cookies()
        except Exception:
            pass
        try:
            bm.quit_driver()
            print("[CCA] Browser closed")
        except Exception:
            pass
    except Exception as e:
        print(f"[CCA] Could not close browser: {e}")


async def start_cca_run(sid: str, data: dict, url: str):
    """
    Run the CCA eligibility check workflow (no OTP):
    1. Login
    2. Search patient by Subscriber ID + DOB
    3. Extract eligibility info + PDF
    """
    s = sessions.get(sid)
    if not s:
        return {"status": "error", "message": "session not found"}

    s["status"] = "running"
    s["last_activity"] = time.time()
    bot = None

    try:
        bot = AutomationCCAEligibilityCheck({"data": data})
        bot.config_driver()

        s["bot"] = bot
        s["driver"] = bot.driver
        s["last_activity"] = time.time()

        try:
            bot.driver.maximize_window()
        except Exception:
            pass

        try:
            login_result = bot.login(url)
        except WebDriverException as wde:
            s["status"] = "error"
            s["message"] = f"Selenium driver error during login: {wde}"
            s["result"] = {"status": "error", "message": s["message"]}
            _close_browser(bot)
            asyncio.create_task(_remove_session_later(sid, 30))
            return {"status": "error", "message": s["message"]}
        except Exception as e:
            s["status"] = "error"
            s["message"] = f"Unexpected error during login: {e}"
            s["result"] = {"status": "error", "message": s["message"]}
            _close_browser(bot)
            asyncio.create_task(_remove_session_later(sid, 30))
            return {"status": "error", "message": s["message"]}

        if isinstance(login_result, str) and login_result == "ALREADY_LOGGED_IN":
            s["status"] = "running"
            s["message"] = "Session persisted"
            print("[CCA] Session persisted - skipping login")
            get_browser_manager().save_cookies()

        elif isinstance(login_result, str) and login_result.startswith("ERROR"):
            s["status"] = "error"
            s["message"] = login_result
            s["result"] = {"status": "error", "message": login_result}
            _close_browser(bot)
            asyncio.create_task(_remove_session_later(sid, 30))
            return {"status": "error", "message": login_result}

        elif isinstance(login_result, str) and login_result == "SUCCESS":
            print("[CCA] Login succeeded")
            s["status"] = "running"
            s["message"] = "Login succeeded"
            get_browser_manager().save_cookies()

        # Step 1 - search patient and verify eligibility
        step1_result = bot.step1()
        print(f"[CCA] step1 result: {step1_result}")

        if isinstance(step1_result, str) and step1_result.startswith("ERROR"):
            s["status"] = "error"
            s["message"] = step1_result
            s["result"] = {"status": "error", "message": step1_result}
            _close_browser(bot)
            asyncio.create_task(_remove_session_later(sid, 30))
            return {"status": "error", "message": step1_result}

        # Step 2 - extract eligibility info + PDF
        step2_result = bot.step2()
        print(f"[CCA] step2 result: {step2_result.get('status') if isinstance(step2_result, dict) else step2_result}")

        if isinstance(step2_result, dict):
            s["status"] = "completed"
            s["result"] = step2_result
            s["message"] = "completed"
            asyncio.create_task(_remove_session_later(sid, 60))
            return step2_result
        else:
            s["status"] = "error"
            s["message"] = f"step2 returned unexpected result: {step2_result}"
            s["result"] = {"status": "error", "message": s["message"]}
            _close_browser(bot)
            asyncio.create_task(_remove_session_later(sid, 30))
            return {"status": "error", "message": s["message"]}

    except Exception as e:
        if s:
            s["status"] = "error"
            s["message"] = f"worker exception: {e}"
            s["result"] = {"status": "error", "message": s["message"]}
        if bot:
            _close_browser(bot)
        asyncio.create_task(_remove_session_later(sid, 30))
        return {"status": "error", "message": f"worker exception: {e}"}


def get_session_status(sid: str) -> Dict[str, Any]:
    s = sessions.get(sid)
    if not s:
        return {"status": "not_found"}
    return {
        "session_id": sid,
        "status": s.get("status"),
        "message": s.get("message"),
        "created_at": s.get("created_at"),
        "last_activity": s.get("last_activity"),
        "result": s.get("result") if s.get("status") in ("completed", "error") else None,
    }
