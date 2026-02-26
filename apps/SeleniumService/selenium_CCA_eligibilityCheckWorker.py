from selenium import webdriver
from selenium.common.exceptions import WebDriverException, TimeoutException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import time
import os
import base64
import re
import glob
from datetime import datetime

from cca_browser_manager import get_browser_manager

LOGIN_URL = "https://pwp.sciondental.com/PWP/Landing"
LANDING_URL = "https://pwp.sciondental.com/PWP/Landing"


class AutomationCCAEligibilityCheck:
    def __init__(self, data):
        self.headless = False
        self.driver = None

        self.data = data.get("data", {}) if isinstance(data, dict) else {}

        self.memberId = self.data.get("memberId", "")
        self.dateOfBirth = self.data.get("dateOfBirth", "")
        self.firstName = self.data.get("firstName", "")
        self.lastName = self.data.get("lastName", "")
        self.cca_username = self.data.get("cca_username", "")
        self.cca_password = self.data.get("cca_password", "")

        self.download_dir = get_browser_manager().download_dir
        os.makedirs(self.download_dir, exist_ok=True)

    def config_driver(self):
        self.driver = get_browser_manager().get_driver(self.headless)

    def _close_browser(self):
        browser_manager = get_browser_manager()
        try:
            browser_manager.save_cookies()
        except Exception as e:
            print(f"[CCA] Failed to save cookies before close: {e}")
        try:
            browser_manager.quit_driver()
            print("[CCA] Browser closed")
        except Exception as e:
            print(f"[CCA] Could not close browser: {e}")

    def _force_logout(self):
        try:
            print("[CCA login] Forcing logout due to credential change...")
            browser_manager = get_browser_manager()
            try:
                self.driver.delete_all_cookies()
            except Exception:
                pass
            browser_manager.clear_credentials_hash()
            print("[CCA login] Logout complete")
            return True
        except Exception as e:
            print(f"[CCA login] Error during forced logout: {e}")
            return False

    def _page_has_logged_in_content(self):
        """Quick check if the current page shows logged-in portal content."""
        try:
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            return ("Verify Patient Eligibility" in body_text
                    or "Patient Management" in body_text
                    or "Submit a Claim" in body_text
                    or "Claim Inquiry" in body_text)
        except Exception:
            return False

    def login(self, url):
        """
        Login to ScionDental portal for CCA.
        No OTP required - simple username/password login.
        Returns: ALREADY_LOGGED_IN, SUCCESS, or ERROR:...
        """
        browser_manager = get_browser_manager()

        try:
            if self.cca_username and browser_manager.credentials_changed(self.cca_username):
                self._force_logout()
                self.driver.get(url)
                time.sleep(2)

            # Check current page state first (no navigation needed)
            try:
                current_url = self.driver.current_url
                print(f"[CCA login] Current URL: {current_url}")
                if ("sciondental.com" in current_url
                        and "login" not in current_url.lower()
                        and self._page_has_logged_in_content()):
                    print("[CCA login] Already logged in")
                    return "ALREADY_LOGGED_IN"
            except Exception as e:
                print(f"[CCA login] Error checking current state: {e}")

            # Navigate to landing page to check session
            print("[CCA login] Checking session at landing page...")
            self.driver.get(LANDING_URL)
            try:
                WebDriverWait(self.driver, 10).until(
                    lambda d: "sciondental.com" in d.current_url
                )
            except TimeoutException:
                pass
            time.sleep(2)

            current_url = self.driver.current_url
            print(f"[CCA login] After landing nav URL: {current_url}")

            if self._page_has_logged_in_content():
                print("[CCA login] Session still valid")
                return "ALREADY_LOGGED_IN"

            # Session expired — navigate to login URL
            print("[CCA login] Session not valid, navigating to login page...")
            self.driver.get(url)
            time.sleep(2)

            current_url = self.driver.current_url
            print(f"[CCA login] After login nav URL: {current_url}")

            # Enter username
            print("[CCA login] Looking for username field...")
            username_entered = False
            for sel in [
                (By.ID, "Username"),
                (By.NAME, "Username"),
                (By.XPATH, "//input[@type='text']"),
            ]:
                try:
                    field = WebDriverWait(self.driver, 6).until(
                        EC.presence_of_element_located(sel))
                    if field.is_displayed():
                        field.clear()
                        field.send_keys(self.cca_username)
                        username_entered = True
                        print(f"[CCA login] Username entered via {sel}")
                        break
                except Exception:
                    continue

            if not username_entered:
                if self._page_has_logged_in_content():
                    return "ALREADY_LOGGED_IN"
                return "ERROR: Could not find username field"

            # Enter password
            print("[CCA login] Looking for password field...")
            pw_entered = False
            for sel in [
                (By.ID, "Password"),
                (By.NAME, "Password"),
                (By.XPATH, "//input[@type='password']"),
            ]:
                try:
                    field = self.driver.find_element(*sel)
                    if field.is_displayed():
                        field.clear()
                        field.send_keys(self.cca_password)
                        pw_entered = True
                        print(f"[CCA login] Password entered via {sel}")
                        break
                except Exception:
                    continue

            if not pw_entered:
                return "ERROR: Password field not found"

            # Click login button
            for sel in [
                (By.XPATH, "//button[@type='submit']"),
                (By.XPATH, "//input[@type='submit']"),
                (By.XPATH, "//button[contains(text(),'Sign In') or contains(text(),'Log In') or contains(text(),'Login')]"),
                (By.XPATH, "//input[@value='Sign In' or @value='Log In' or @value='Login']"),
            ]:
                try:
                    btn = self.driver.find_element(*sel)
                    if btn.is_displayed():
                        btn.click()
                        print(f"[CCA login] Clicked login button via {sel}")
                        break
                except Exception:
                    continue

            if self.cca_username:
                browser_manager.save_credentials_hash(self.cca_username)

            # Wait for page to load after login
            try:
                WebDriverWait(self.driver, 15).until(
                    lambda d: "Landing" in d.current_url
                              or "Dental" in d.current_url
                              or "Home" in d.current_url
                )
                print("[CCA login] Redirected to portal page")
            except TimeoutException:
                time.sleep(3)

            current_url = self.driver.current_url
            print(f"[CCA login] After login submit URL: {current_url}")

            # Check for login errors
            try:
                body_text = self.driver.find_element(By.TAG_NAME, "body").text
                if "invalid" in body_text.lower() and ("password" in body_text.lower() or "username" in body_text.lower()):
                    return "ERROR: Invalid username or password"
            except Exception:
                pass

            if self._page_has_logged_in_content():
                print("[CCA login] Login successful")
                return "SUCCESS"

            if "Landing" in current_url or "Home" in current_url or "Dental" in current_url:
                return "SUCCESS"

            # Check for errors
            try:
                errors = self.driver.find_elements(By.XPATH,
                    "//*[contains(@class,'error') or contains(@class,'alert-danger') or contains(@class,'validation-summary')]")
                for err in errors:
                    if err.is_displayed() and err.text.strip():
                        return f"ERROR: {err.text.strip()[:200]}"
            except Exception:
                pass

            print("[CCA login] Login completed (assuming success)")
            return "SUCCESS"

        except Exception as e:
            print(f"[CCA login] Exception: {e}")
            return f"ERROR:LOGIN FAILED: {e}"

    def _format_dob(self, dob_str):
        if dob_str and "-" in dob_str:
            dob_parts = dob_str.split("-")
            if len(dob_parts) == 3:
                return f"{dob_parts[1]}/{dob_parts[2]}/{dob_parts[0]}"
        return dob_str

    def step1(self):
        """
        Enter patient info and click Verify Eligibility.
        """
        try:
            formatted_dob = self._format_dob(self.dateOfBirth)
            today_str = datetime.now().strftime("%m/%d/%Y")
            print(f"[CCA step1] Starting — memberId={self.memberId}, DOB={formatted_dob}, DateOfService={today_str}")

            # Always navigate fresh to Landing to reset page state
            print("[CCA step1] Navigating to eligibility page...")
            self.driver.get(LANDING_URL)

            # Wait for the page to fully load with the eligibility form
            try:
                WebDriverWait(self.driver, 15).until(
                    lambda d: "Verify Patient Eligibility" in d.find_element(By.TAG_NAME, "body").text
                )
                print("[CCA step1] Eligibility form loaded")
            except TimeoutException:
                print("[CCA step1] Eligibility form not found after 15s, checking page...")
                body_text = self.driver.find_element(By.TAG_NAME, "body").text
                print(f"[CCA step1] Page text (first 300): {body_text[:300]}")

            time.sleep(1)

            # Select "Subscriber ID and date of birth" radio
            print("[CCA step1] Selecting 'Subscriber ID and date of birth' option...")
            for sel in [
                (By.XPATH, "//input[@type='radio' and contains(@id,'SubscriberId')]"),
                (By.XPATH, "//input[@type='radio'][following-sibling::*[contains(text(),'Subscriber ID')]]"),
                (By.XPATH, "//label[contains(text(),'Subscriber ID')]//input[@type='radio']"),
                (By.XPATH, "(//input[@type='radio'])[1]"),
            ]:
                try:
                    radio = self.driver.find_element(*sel)
                    if radio.is_displayed():
                        if not radio.is_selected():
                            radio.click()
                            print(f"[CCA step1] Selected radio via {sel}")
                        else:
                            print("[CCA step1] Radio already selected")
                        break
                except Exception:
                    continue

            # Enter Subscriber ID
            print(f"[CCA step1] Entering Subscriber ID: {self.memberId}")
            sub_id_entered = False
            for sel in [
                (By.ID, "SubscriberId"),
                (By.NAME, "SubscriberId"),
                (By.XPATH, "//input[contains(@id,'SubscriberId')]"),
                (By.XPATH, "//label[contains(text(),'Subscriber ID')]/following::input[1]"),
            ]:
                try:
                    field = self.driver.find_element(*sel)
                    if field.is_displayed():
                        field.click()
                        field.send_keys(Keys.CONTROL + "a")
                        field.send_keys(Keys.DELETE)
                        field.send_keys(self.memberId)
                        time.sleep(0.3)
                        print(f"[CCA step1] Subscriber ID entered: '{field.get_attribute('value')}'")
                        sub_id_entered = True
                        break
                except Exception:
                    continue

            if not sub_id_entered:
                return "ERROR: Subscriber ID field not found"

            # Enter Date of Birth
            print(f"[CCA step1] Entering DOB: {formatted_dob}")
            dob_entered = False
            for sel in [
                (By.ID, "DateOfBirth"),
                (By.NAME, "DateOfBirth"),
                (By.XPATH, "//input[contains(@id,'DateOfBirth') or contains(@id,'dob')]"),
                (By.XPATH, "//label[contains(text(),'Date of Birth')]/following::input[1]"),
            ]:
                try:
                    field = self.driver.find_element(*sel)
                    if field.is_displayed():
                        field.click()
                        field.send_keys(Keys.CONTROL + "a")
                        field.send_keys(Keys.DELETE)
                        field.send_keys(formatted_dob)
                        time.sleep(0.3)
                        print(f"[CCA step1] DOB entered: '{field.get_attribute('value')}'")
                        dob_entered = True
                        break
                except Exception:
                    continue

            if not dob_entered:
                return "ERROR: Date of Birth field not found"

            # Set Date of Service to today
            print(f"[CCA step1] Setting Date of Service: {today_str}")
            for sel in [
                (By.ID, "DateOfService"),
                (By.NAME, "DateOfService"),
                (By.XPATH, "//input[contains(@id,'DateOfService')]"),
                (By.XPATH, "//label[contains(text(),'Date of Service')]/following::input[1]"),
            ]:
                try:
                    field = self.driver.find_element(*sel)
                    if field.is_displayed():
                        field.click()
                        field.send_keys(Keys.CONTROL + "a")
                        field.send_keys(Keys.DELETE)
                        field.send_keys(today_str)
                        time.sleep(0.3)
                        print(f"[CCA step1] Date of Service set: '{field.get_attribute('value')}'")
                        break
                except Exception:
                    continue

            # Click "Verify Eligibility"
            print("[CCA step1] Clicking 'Verify Eligibility'...")
            clicked = False
            for sel in [
                (By.XPATH, "//button[contains(text(),'Verify Eligibility')]"),
                (By.XPATH, "//input[@value='Verify Eligibility']"),
                (By.XPATH, "//a[contains(text(),'Verify Eligibility')]"),
                (By.XPATH, "//*[@id='btnVerifyEligibility']"),
            ]:
                try:
                    btn = self.driver.find_element(*sel)
                    if btn.is_displayed():
                        btn.click()
                        clicked = True
                        print(f"[CCA step1] Clicked Verify Eligibility via {sel}")
                        break
                except Exception:
                    continue

            if not clicked:
                return "ERROR: Could not find 'Verify Eligibility' button"

            # Wait for result using WebDriverWait instead of fixed sleep
            print("[CCA step1] Waiting for eligibility result...")
            try:
                WebDriverWait(self.driver, 30).until(
                    lambda d: "Patient Selected" in d.find_element(By.TAG_NAME, "body").text
                              or "Patient Information" in d.find_element(By.TAG_NAME, "body").text
                              or "patient is eligible" in d.find_element(By.TAG_NAME, "body").text.lower()
                              or "not eligible" in d.find_element(By.TAG_NAME, "body").text.lower()
                              or "no results" in d.find_element(By.TAG_NAME, "body").text.lower()
                              or "not found" in d.find_element(By.TAG_NAME, "body").text.lower()
                )
                print("[CCA step1] Eligibility result appeared")
            except TimeoutException:
                print("[CCA step1] Timed out waiting for result, checking page...")

            time.sleep(1)

            # Check for errors
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            if "no results" in body_text.lower() or "not found" in body_text.lower() or "no patient" in body_text.lower():
                return "ERROR: No patient found with the provided Subscriber ID and DOB"

            # Check for error alerts
            try:
                alerts = self.driver.find_elements(By.XPATH,
                    "//*[@role='alert'] | //*[contains(@class,'alert-danger')]")
                for alert in alerts:
                    if alert.is_displayed() and alert.text.strip():
                        return f"ERROR: {alert.text.strip()[:200]}"
            except Exception:
                pass

            return "SUCCESS"

        except Exception as e:
            print(f"[CCA step1] Exception: {e}")
            return f"ERROR: step1 failed: {e}"

    def step2(self):
        """
        Extract all patient information from the result popup,
        capture the eligibility report PDF, and return everything.
        """
        try:
            print("[CCA step2] Extracting eligibility data...")
            time.sleep(1)

            patientName = ""
            extractedDob = ""
            foundMemberId = ""
            eligibility = "Unknown"
            address = ""
            city = ""
            zipCode = ""
            insurerName = ""

            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            print(f"[CCA step2] Page text (first 800): {body_text[:800]}")

            # --- Eligibility status ---
            if "patient is eligible" in body_text.lower():
                eligibility = "Eligible"
            elif "not eligible" in body_text.lower() or "ineligible" in body_text.lower():
                eligibility = "Not Eligible"

            # --- Patient name ---
            for sel in [
                (By.XPATH, "//*[contains(@class,'patient-name') or contains(@class,'PatientName')]"),
                (By.XPATH, "//div[contains(@class,'modal')]//strong"),
                (By.XPATH, "//div[contains(@class,'modal')]//b"),
                (By.XPATH, "//*[contains(text(),'Patient Information')]/following::*[1]"),
            ]:
                try:
                    el = self.driver.find_element(*sel)
                    name = el.text.strip()
                    if name and 2 < len(name) < 100:
                        patientName = name
                        print(f"[CCA step2] Patient name via DOM: {patientName}")
                        break
                except Exception:
                    continue

            if not patientName:
                name_match = re.search(r'Patient Information\s*\n+\s*([A-Z][A-Za-z\s\-\']+)', body_text)
                if name_match:
                    raw = name_match.group(1).strip().split('\n')[0].strip()
                    for stop in ['Subscriber', 'Address', 'Date', 'DOB', 'Member']:
                        if stop in raw:
                            raw = raw[:raw.index(stop)].strip()
                    patientName = raw
                    print(f"[CCA step2] Patient name via regex: {patientName}")

            # --- Subscriber ID ---
            sub_match = re.search(r'Subscriber\s*ID:?\s*(\d+)', body_text)
            if sub_match:
                foundMemberId = sub_match.group(1).strip()
                print(f"[CCA step2] Subscriber ID: {foundMemberId}")
            else:
                foundMemberId = self.memberId

            # --- Date of Birth ---
            dob_match = re.search(r'Date\s*of\s*Birth:?\s*([\d/]+)', body_text)
            if dob_match:
                extractedDob = dob_match.group(1).strip()
                print(f"[CCA step2] DOB: {extractedDob}")
            else:
                extractedDob = self._format_dob(self.dateOfBirth)

            # --- Address, City, State, Zip ---
            # The search results table shows: "YVONNE KADLIK\n107 HARTFORD AVE W\nMENDON, MA 01756"
            # Try extracting from the result table row (name followed by address lines)
            if patientName:
                addr_block_match = re.search(
                    re.escape(patientName) + r'\s*\n\s*(.+?)\s*\n\s*([A-Z][A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-?\d{4})?)',
                    body_text
                )
                if addr_block_match:
                    address = addr_block_match.group(1).strip()
                    city = addr_block_match.group(2).strip()
                    state = addr_block_match.group(3).strip()
                    zipCode = addr_block_match.group(4).strip()
                    address = f"{address}, {city}, {state} {zipCode}"
                    print(f"[CCA step2] Address: {address}, City: {city}, State: {state}, Zip: {zipCode}")

            # Fallback: look for "Address: ..." in Patient Information section
            if not address:
                addr_match = re.search(
                    r'Patient Information.*?Address:?\s+(\d+.+?)(?:Date of Birth|DOB|\n\s*\n)',
                    body_text, re.DOTALL
                )
                if addr_match:
                    raw_addr = addr_match.group(1).strip().replace('\n', ', ')
                    address = raw_addr
                    print(f"[CCA step2] Address (from Patient Info): {address}")

            if not city:
                city_match = re.search(
                    r'([A-Z][A-Za-z]+),\s*([A-Z]{2})\s+(\d{5}(?:-?\d{4})?)',
                    address or body_text
                )
                if city_match:
                    city = city_match.group(1).strip()
                    zipCode = city_match.group(3).strip()
                    print(f"[CCA step2] City: {city}, Zip: {zipCode}")

            # --- Insurance provider name ---
            # Look for insurer name like "Commonwealth Care Alliance"
            insurer_match = re.search(
                r'(?:Commonwealth\s+Care\s+Alliance|'
                r'Delta\s+Dental|'
                r'Tufts\s+Health|'
                r'MassHealth|'
                r'United\s+Healthcare)',
                body_text,
                re.IGNORECASE
            )
            if insurer_match:
                insurerName = insurer_match.group(0).strip()
                print(f"[CCA step2] Insurer: {insurerName}")

            # Also try generic pattern after "View Benefits" section
            if not insurerName:
                ins_match = re.search(
                    r'View Eligibility Report\s*\n+\s*(.+?)(?:\n|View Benefits)',
                    body_text
                )
                if ins_match:
                    candidate = ins_match.group(1).strip()
                    if 3 < len(candidate) < 80 and not candidate.startswith("Start"):
                        insurerName = candidate
                        print(f"[CCA step2] Insurer via context: {insurerName}")

            # --- PDF capture ---
            print("[CCA step2] Clicking 'View Eligibility Report'...")
            pdfBase64 = ""

            try:
                existing_files = set(glob.glob(os.path.join(self.download_dir, "*")))
                original_window = self.driver.current_window_handle
                original_handles = set(self.driver.window_handles)

                view_report_clicked = False
                for sel in [
                    (By.XPATH, "//button[contains(text(),'View Eligibility Report')]"),
                    (By.XPATH, "//input[@value='View Eligibility Report']"),
                    (By.XPATH, "//a[contains(text(),'View Eligibility Report')]"),
                    (By.XPATH, "//*[contains(text(),'View Eligibility Report')]"),
                ]:
                    try:
                        btn = self.driver.find_element(*sel)
                        if btn.is_displayed():
                            btn.click()
                            view_report_clicked = True
                            print(f"[CCA step2] Clicked 'View Eligibility Report' via {sel}")
                            break
                    except Exception:
                        continue

                if not view_report_clicked:
                    print("[CCA step2] 'View Eligibility Report' button not found")
                    raise Exception("View Eligibility Report button not found")

                # Wait for download to start
                time.sleep(3)

                # Check for downloaded file (this site downloads rather than opens in-tab)
                pdf_path = None
                for i in range(15):
                    time.sleep(1)
                    current_files = set(glob.glob(os.path.join(self.download_dir, "*")))
                    new_files = current_files - existing_files
                    completed = [f for f in new_files
                                 if not f.endswith(".crdownload") and not f.endswith(".tmp")]
                    if completed:
                        pdf_path = completed[0]
                        print(f"[CCA step2] PDF downloaded: {pdf_path}")
                        break

                if pdf_path and os.path.exists(pdf_path):
                    with open(pdf_path, "rb") as f:
                        pdfBase64 = base64.b64encode(f.read()).decode()
                    print(f"[CCA step2] PDF from download: {os.path.basename(pdf_path)} "
                          f"({os.path.getsize(pdf_path)} bytes), b64 len={len(pdfBase64)}")
                    try:
                        os.remove(pdf_path)
                    except Exception:
                        pass
                else:
                    # Fallback: check for new window
                    new_handles = set(self.driver.window_handles) - original_handles
                    if new_handles:
                        new_window = new_handles.pop()
                        self.driver.switch_to.window(new_window)
                        time.sleep(3)
                        print(f"[CCA step2] Switched to new window: {self.driver.current_url}")

                        try:
                            cdp_result = self.driver.execute_cdp_cmd("Page.printToPDF", {
                                "printBackground": True,
                                "preferCSSPageSize": True,
                                "scale": 0.8,
                                "paperWidth": 8.5,
                                "paperHeight": 11,
                            })
                            pdf_data = cdp_result.get("data", "")
                            if len(pdf_data) > 2000:
                                pdfBase64 = pdf_data
                                print(f"[CCA step2] PDF from new window, b64 len={len(pdfBase64)}")
                        except Exception as e:
                            print(f"[CCA step2] CDP in new window failed: {e}")

                        try:
                            self.driver.close()
                            self.driver.switch_to.window(original_window)
                        except Exception:
                            pass

                    # Final fallback: CDP on main page
                    if not pdfBase64 or len(pdfBase64) < 2000:
                        print("[CCA step2] Falling back to CDP PDF from main page...")
                        try:
                            try:
                                self.driver.switch_to.window(original_window)
                            except Exception:
                                pass
                            cdp_result = self.driver.execute_cdp_cmd("Page.printToPDF", {
                                "printBackground": True,
                                "preferCSSPageSize": True,
                                "scale": 0.7,
                                "paperWidth": 11,
                                "paperHeight": 17,
                            })
                            pdfBase64 = cdp_result.get("data", "")
                            print(f"[CCA step2] Main page CDP PDF, b64 len={len(pdfBase64)}")
                        except Exception as e2:
                            print(f"[CCA step2] Main page CDP failed: {e2}")

            except Exception as e:
                print(f"[CCA step2] PDF capture failed: {e}")
                try:
                    cdp_result = self.driver.execute_cdp_cmd("Page.printToPDF", {
                        "printBackground": True,
                        "preferCSSPageSize": True,
                        "scale": 0.7,
                        "paperWidth": 11,
                        "paperHeight": 17,
                    })
                    pdfBase64 = cdp_result.get("data", "")
                    print(f"[CCA step2] CDP fallback PDF, b64 len={len(pdfBase64)}")
                except Exception as e2:
                    print(f"[CCA step2] CDP fallback also failed: {e2}")

            self._close_browser()

            result = {
                "status": "success",
                "patientName": patientName,
                "eligibility": eligibility,
                "pdfBase64": pdfBase64,
                "extractedDob": extractedDob,
                "memberId": foundMemberId,
                "address": address,
                "city": city,
                "zipCode": zipCode,
                "insurerName": insurerName,
            }

            print(f"[CCA step2] Result: name={result['patientName']}, "
                  f"eligibility={result['eligibility']}, "
                  f"memberId={result['memberId']}, "
                  f"address={result['address']}, "
                  f"city={result['city']}, zip={result['zipCode']}, "
                  f"insurer={result['insurerName']}")

            return result

        except Exception as e:
            print(f"[CCA step2] Exception: {e}")
            self._close_browser()
            return {
                "status": "error",
                "patientName": f"{self.firstName} {self.lastName}".strip(),
                "eligibility": "Unknown",
                "pdfBase64": "",
                "extractedDob": self._format_dob(self.dateOfBirth),
                "memberId": self.memberId,
                "address": "",
                "city": "",
                "zipCode": "",
                "insurerName": "",
                "error": str(e),
            }
