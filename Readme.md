# ☁️ Cloud Drive Backend

A RESTful backend API for a **Cloud Storage / Drive Management System**, developed as part of the **Labmentix Web Development Internship**.

The application provides secure user authentication, file and folder management, sharing, search, recent-file tracking, starred items, and public share links.

---

## 📌 Project Overview

The Cloud Drive Backend provides the server-side functionality required for a cloud storage application similar to Google Drive.

Users can:

- Register and log in securely
- Upload and manage files
- Create and manage folders
- Organize files inside folders
- Share files with other users
- Assign viewer/editor permissions
- Search files and folders
- View recently accessed files
- Star important files and folders
- Generate public share links
- Revoke public share links

The backend is built using **Node.js and Express.js** and uses **Supabase/PostgreSQL** for database and storage functionality.

---

## ✨ Features

### 🔐 Authentication

- User registration
- User login
- Password hashing
- JWT-based authentication
- Protected API routes
- User-specific resources

### 📁 Folder Management

- Create folders
- View folders
- Rename folders
- Delete folders
- Organize files inside folders
- Support for folder hierarchy

### 📄 File Management

- Upload files
- Retrieve file information
- Rename files
- Delete files
- Store file metadata
- Track file size and MIME type
- Associate files with folders

### 🤝 File Sharing

Users can share files with other registered users.

Supported permissions:

- `viewer`
- `editor`

Users can also:

- View people with access to a file
- Update sharing permissions
- View files shared with them
- Revoke file access

### 🔗 Public Share Links

Users can generate public links for files.

Features include:

- Generate secure public share tokens
- Access shared resources using the token
- Enable/disable public links
- Revoke existing public links
- Optional link expiration support

### 🔎 Search

Search functionality supports:

- Searching by file name
- Searching by folder name
- Filtering files only
- Filtering folders only
- Sorting by name
- Sorting by creation date
- Ascending and descending ordering

### 🕒 Recent Files

The API tracks file access and allows users to retrieve recently accessed files.

### ⭐ Starred Items

Users can:

- Star files
- Unstar files
- Star folders
- Unstar folders
- Retrieve all starred items

---

## 🛠️ Tech Stack

### Backend

- Node.js
- Express.js

### Database & Storage

- PostgreSQL
- Supabase

### Authentication & Security

- JSON Web Tokens (JWT)
- bcrypt
- Authentication middleware

### File Upload

- Multer

### API Testing

- Postman

### Version Control

- Git
- GitHub

---

## 📂 Project Structure

```text
cloud-drive-backend/
│
├── src/
│   ├── config/
│   │   └── supabase.js
│   │
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── fileController.js
│   │   ├── folderController.js
│   │   ├── linkShareController.js
│   │   ├── recentController.js
│   │   ├── searchController.js
│   │   ├── shareController.js
│   │   └── starController.js
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   └── uploadMiddleware.js
│   │
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── fileRoutes.js
│   │   ├── folderRoutes.js
│   │   ├── linkShareRoutes.js
│   │   ├── recentRoutes.js
│   │   ├── searchRoutes.js
│   │   ├── shareRoutes.js
│   │   └── starRoutes.js
│   │
│   ├── services/
│   │   └── storageService.js
│   │
│   ├── utils/
│   │   └── generateToken.js
│   │
│   ├── app.js
│   └── server.js
│
├── postman/
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── Readme.md
```

---

## 🔌 API Endpoints

Base URL for local development:

```text
http://localhost:5000/api
```

---

## 🔐 Authentication APIs

Authentication routes are available under:

```text
/api/auth
```

These endpoints handle user registration, login, and authentication.

Protected endpoints require a JWT token.

Example authorization header:

```text
Authorization: Bearer <YOUR_TOKEN>
```

---

## 📁 Folder APIs

Folder routes are available under:

```text
/api/folders
```

These APIs handle operations such as:

- Creating folders
- Retrieving folders
- Renaming folders
- Deleting folders

---

## 📄 File APIs

File routes are available under:

```text
/api/files
```

These APIs handle:

- File uploads
- File retrieval
- File metadata
- File updates
- File deletion

Example:

```http
GET /api/files/:id
```

---

## 🤝 Sharing APIs

Sharing routes are available under:

```text
/api/shares
```

### Get users who have access to a file

```http
GET /api/shares?fileId=<FILE_ID>
```

### Update Permission

```http
PATCH /api/shares/:shareId
```

Example request body:

```json
{
  "permission": "editor"
}
```

### Remove Access

```http
DELETE /api/shares/:shareId
```

### Get Files Shared With the Logged-In User

```http
GET /api/shares/shared-with-me
```

---

## 🔎 Search API

### Search

```http
GET /api/search
```

### Search by Name

```http
GET /api/search?q=NextLeap
```

### Search Files Only

```http
GET /api/search?type=file
```

### Search Folders Only

```http
GET /api/search?type=folder
```

### Sort by Creation Date

```http
GET /api/search?sortBy=created_at&order=desc
```

### Sort Alphabetically

```http
GET /api/search?sortBy=name&order=asc
```

---

## 🕒 Recent Files API

```http
GET /api/recent
```

Returns recently accessed files for the authenticated user.

---

## ⭐ Starred Items APIs

### Star or Unstar a File

```http
PATCH /api/star/files/:id
```

### Star or Unstar a Folder

```http
PATCH /api/star/folders/:id
```

### Get Starred Items

```http
GET /api/star
```

---

## 🔗 Public Share Links

The application supports public share links using secure tokens.

Users can:

- Generate public links
- Access resources through public links
- Revoke public links

A revoked or invalid link returns an appropriate error response.

Example:

```json
{
  "error": {
    "code": "LINK_NOT_FOUND",
    "message": "Share link is invalid or disabled"
  }
}
```

---

## 🔒 Authentication

Protected endpoints require a valid JWT.

In Postman:

1. Open the request.
2. Select **Authorization**.
3. Select **Bearer Token**.
4. Paste the JWT token.
5. Send the request.

Example:

```text
Authorization: Bearer eyJhbGciOi...
```

---

## ⚙️ Environment Variables

Create a `.env` file in the project root.

Use `.env.example` as the template.

Example:

```env
PORT=5000
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
JWT_SECRET=your_jwt_secret
```

> **Important:** Never commit the actual `.env` file, API keys, JWT secrets, passwords, or other credentials to GitHub.

The `.env` file should remain listed in `.gitignore`.

---

## 💻 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
```

### 2. Enter the Project Directory

```bash
cd cloud-drive-backend
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file and add the required Supabase and JWT configuration.

### 5. Start the Development Server

```bash
npm run dev
```

Or, depending on the scripts configured in `package.json`:

```bash
npm start
```

---

## 🚀 Running Locally

After starting the backend, the API runs locally at:

```text
http://localhost:5000
```

Opening the root endpoint should return a response similar to:

```json
{
  "message": "Cloud Drive Backend API is running"
}
```

---

## 🧪 API Testing

The APIs were tested using **Postman**.

Testing covered:

- Authentication
- File operations
- Folder operations
- File sharing
- Permission updates
- Share revocation
- Search
- Recent files
- Starred files
- Starred folders
- Public share links
- Invalid/revoked share links
- Authorization checks

---

## 🗄️ Database

The application uses **Supabase PostgreSQL**.

Main tables include:

```text
users
files
folders
shares
link_shares
```

The database stores information including:

- User accounts
- File metadata
- Folder metadata
- Ownership information
- File/folder relationships
- Sharing permissions
- Public share tokens
- Starred status
- File access information

---

## 🔐 Security Features

The backend includes:

- Password hashing
- JWT authentication
- Protected routes
- Resource ownership validation
- Sharing permission checks
- Secure public share tokens
- Public link revocation
- Environment-based secrets
- File upload validation
- Centralized error handling

---

## 🧪 Example Error Response

Unauthorized or forbidden operations return structured error responses.

Example:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this file"
  }
}
```

---

## 🚧 Future Improvements

Potential improvements include:

- Cloud Drive frontend interface
- Drag-and-drop uploads
- File previews
- Storage usage dashboard
- Trash and restore functionality
- Folder sharing
- Download history
- Advanced search filters
- File versioning
- Improved activity tracking
- Pagination for large file collections
- Email notifications for shared files
- Deployment and production monitoring

---

## 🎯 Project Objective

The objective of this project is to demonstrate the development of a secure and scalable backend for a cloud storage platform while implementing practical concepts such as:

- REST API development
- Authentication
- Authorization
- Database integration
- Cloud storage
- File handling
- Resource sharing
- Search and filtering
- Error handling
- API testing

---

## 👩‍💻 Author

**Aabha Tembhurne**

Web Development Intern  
**Labmentix**

---

## 📄 License

This project was developed for educational and internship purposes.