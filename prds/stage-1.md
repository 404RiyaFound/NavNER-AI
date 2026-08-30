### **Stage 1 PRD: Foundational Infrastructure, GIS Mapping & Offline Reporting**

**Objective:** Establish the core data pipeline, geospatial database, web command center interface, and the offline-capable mobile reporting module. This stage acts as the bedrock for the AI prediction and routing algorithms to be implemented in subsequent stages.

---

### **1. System Architecture & Tech Stack (Stage 1)**

* **Database:** PostgreSQL with PostGIS extension for geospatial querying.
* **Backend:** Python (FastAPI) for high-performance, asynchronous REST APIs.
* **Frontend (Web):** React.js with Mapbox GL JS for rendering heavy multi-layer maps.
* **Frontend (Mobile):** React Native with SQLite (or WatermelonDB) for local data caching.
* **Cloud Storage:** AWS S3 (or equivalent) for hosting geo-tagged field photographs.

---

### **2. Database Schema (Core Data Models)**

| Table Name | Key Columns | Description |
| --- | --- | --- |
| **Users** | `id`, `name`, `role`, `auth_token`, `district` | Manages dashboard admins and field officials. |
| **Vehicles** | `id`, `type`, `status`, `current_lat`, `current_lng`, `last_ping` | Tracks essential supply trucks. |
| **Incidents** | `id`, `type` (flood, landslide), `lat`, `lng`, `image_url`, `status` | Stores field reports and roadblocks. |
| **Telemetry** | `id`, `vehicle_id`, `lat`, `lng`, `speed`, `timestamp` | Time-series data of vehicle movements. |

---

### **3. Feature Specifications**

**A. Command Center Web Dashboard**

* Initialize a full-screen interactive Mapbox canvas centered on the North Eastern Region.
* Implement a WebSocket connection to receive and plot live vehicle GPS coordinates dynamically.
* Render custom markers for different entity types (e.g., blue truck icons for vehicles, red warning icons for incidents).
* Create a side panel displaying a real-time list of incoming incident reports from field officials.

**B. Offline-First Mobile Field App**

* Implement local device storage to capture incident reports when network connectivity is zero.
* Utilize native device APIs to capture precise GPS coordinates and camera images.
* Develop a background sync queue that listens for network state changes and automatically pushes stored local data to the backend REST API upon reconnection.

**C. Backend API Endpoints**

* `POST /api/v1/telemetry`: Ingests GPS pings from vehicles.
* `POST /api/v1/incident`: Accepts multipart form data (text + image) for field reports.
* `GET /api/v1/map-state`: Returns the current active vehicles and unresolved incidents to hydrate the web dashboard upon load.

---

### **4. Mobile UI Generation Prompt**

To generate the exact frontend code for your mobile app, feed the following prompt into your code-generation LLM:

> **System Prompt for Mobile UI Generation:**
> You are an expert React Native developer. Build a single-screen "Field Reporting" mobile application for logistics officials in the North Eastern Region.
> **Visual Theme:** Clean, utilitarian, and high-contrast. Use a primary color of dark navy blue and accent colors of alert red and success green.
> **Core UI Components:**
> 1. **Header:** Title "NER Logistics Field App". Include a dynamic network status indicator in the top right corner (show a green "Online" dot or a red "Offline - Saving Locally" badge).
> 2. **Map Preview:** A small non-interactive map view showing the user's current GPS location with a pin.
> 3. **Form Fields:**
> * Dropdown menu for "Incident Type" (Options: Landslide, Flood, Road Damage, Bridge Collapse).
> * Text area for "Severity/Description".
> 
> 
> 4. **Media Capture:** A large, prominent button styled with a camera icon labeled "Capture Geo-Tagged Photo". Below it, show a thumbnail placeholder for the captured image.
> 5. **Submit Action:** A full-width primary button at the bottom labeled "Submit Report".
> 
> 
> **State Logic Requirements:** Mock the submission state. If the user clicks submit, show a loading spinner. If the mock network state is offline, change the button text to "Saved to Sync Queue" and display a persistent snackbar warning. Ensure the layout is fully responsive and accessible.