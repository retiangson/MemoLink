# MemoLink Deployment Guide

Backend: AWS Lambda (container image) + API Gateway  
Frontend: Azure Static Web Apps (Azure manages its own CI/CD)  
Database: Supabase (unchanged)

---

## Overview

```
GitHub push to main
  ├── backend files changed → GitHub Actions (deploy-backend.yml) → ECR → Lambda
  └── frontend files changed → Azure-generated workflow (auto-created by Azure) → Azure SWA
```

Azure Static Web Apps automatically creates its own GitHub Actions workflow and
injects the deployment token secret into your repo when you connect it to GitHub
during setup. You do not write or manage the frontend workflow yourself.

---

## Part 1 - AWS Setup

### 1.1 Create an IAM User for GitHub Actions

GitHub Actions needs AWS credentials to push to ECR and update Lambda.

1. Go to **AWS Console → IAM → Users → Create user**
2. Name it `memolink-github-actions`
3. Select **"Attach policies directly"**
4. Attach these two managed policies:
   - `AmazonEC2ContainerRegistryPowerUser`
   - `AWSLambdaRole`
5. Click **Create user**
6. Open the user → **Security credentials** tab → **Create access key**
7. Choose **"Application running outside AWS"**
8. Copy the values - you only see the secret once:

```
AWS_ACCESS_KEY_ID     = AKIA...
AWS_SECRET_ACCESS_KEY = wJalr...
```

---

### 1.2 Create an ECR Repository

ECR stores the Docker image that Lambda runs.

1. Go to **AWS Console → ECR → Create repository**
2. Set visibility to **Private**
3. Name it `memolink-backend`
4. Leave all other settings as default → **Create repository**

```
ECR_REPOSITORY = memolink-backend
AWS_REGION     = the region you chose (e.g. ap-southeast-2)
```

---

### 1.3 Push the First Image Manually

Lambda needs an image in ECR before you can create the function.
Run these commands locally once (requires AWS CLI installed and configured).

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region REGION | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com

# Build and push
docker build -t memolink-backend .
docker tag memolink-backend:latest ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/memolink-backend:latest
docker push ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/memolink-backend:latest
```

Replace `REGION` (e.g. `ap-southeast-2`) and `ACCOUNT_ID` (12-digit number from the AWS console top-right).

---

### 1.4 Create the Lambda Function

1. Go to **AWS Console → Lambda → Create function**
2. Choose **"Container image"**
3. Function name: `memolink-api`
4. Click **"Browse images"** → select the `memolink-backend` ECR repo → select `latest`
5. Architecture: **x86_64**
6. Click **Create function**

After creation open the function → **Configuration → General configuration → Edit** and set:

| Setting | Value |
|---|---|
| Timeout | 120 seconds |
| Memory | 512 MB |

```
LAMBDA_FUNCTION_NAME = memolink-api
```

---

### 1.5 Set Lambda Environment Variables

Inside the Lambda function → **Configuration → Environment variables → Edit**

Add every variable from your `.env` file:

| Key | Value |
|---|---|
| `DATABASE_URL` | Your Supabase connection string |
| `OPENAI_API_KEY` | `sk-...` |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` |
| `GEMINI_API_KEY` | Your Gemini key |
| `DEEPSEEK_API_KEY` | Your DeepSeek key (optional) |
| `BRAVE_SEARCH_API_KEY` | Your Brave key |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional |
| `JWT_SECRET_KEY` | Long random string - generate with: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `JWT_ALGORITHM` | `HS256` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Your Gmail address |
| `SMTP_PASSWORD` | Your Gmail app password |
| `SMTP_FROM` | Your Gmail address |
| `FRONTEND_URL` | Your Azure Static Web App URL (fill in after Part 2) |

---

### 1.6 Create an API Gateway (HTTP API)

1. Go to **AWS Console → API Gateway → Create API**
2. Choose **HTTP API → Build**
3. Add integration: **Lambda** → select `memolink-api`
4. API name: `memolink-api-gateway`
5. Route: `$default` (catch-all)
6. Stage: `$default` with auto-deploy enabled
7. Click **Create**

Copy the **Invoke URL** from the API overview page:

```
https://xxxxxxxxxx.execute-api.ap-southeast-2.amazonaws.com
```

This is your `VITE_API_BASE_URL` - used in Part 2 and Part 3.

**Enable CORS:**

Open the API → **CORS → Configure**, set:
- Access-Control-Allow-Origin: `*`
- Access-Control-Allow-Methods: `*`
- Access-Control-Allow-Headers: `*`

---

## Part 2 - Azure Static Web Apps Setup

Azure manages the frontend CI/CD entirely. When you connect your GitHub repo
during setup, Azure:
- Generates a GitHub Actions workflow file in your repo automatically
- Adds the deployment secret to your GitHub repo automatically
- Deploys on every push to `main` automatically

### 2.1 Create the Static Web App

1. Go to **portal.azure.com → Create a resource → Static Web App**
2. Fill in:
   - Resource group: create new → `memolink-rg`
   - Name: `memolink-web`
   - Plan type: **Free**
   - Region: closest to your users
   - Deployment source: **GitHub**
3. Click **Sign in with GitHub** and authorize Azure
4. Select your repository and branch (`main`)
5. Build presets: **React**
6. Set the build details:
   - App location: `memolink_web`
   - Output location: `dist`
7. Click **Review + create → Create**

Azure will commit a workflow file to your repo (e.g. `.github/workflows/azure-static-web-apps-xxxx.yml`)
and add `AZURE_STATIC_WEB_APPS_API_TOKEN` as a GitHub secret automatically.

### 2.2 Set VITE_API_BASE_URL for the Frontend Build

The frontend needs to know the API Gateway URL at build time. Set it in Azure:

1. Open the Static Web App → **Configuration → Application settings**
2. Add:

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | Your API Gateway Invoke URL from Part 1.6 |

Azure passes application settings as environment variables during the build,
so Vite picks up `VITE_API_BASE_URL` automatically.

### 2.3 Note Your Azure URL

The URL is shown on the Static Web App overview page:

```
https://memolink-web.azurestaticapps.net  (example)
```

Go back to **Lambda → Environment variables** and set `FRONTEND_URL` to this value.

---

## Part 3 - GitHub Actions Secrets (Backend Only)

Azure already added its own secret automatically. You only need to add the AWS secrets.

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value | Where to get it |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | Part 1.1 - IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | `wJalr...` | Part 1.1 - IAM user secret key |
| `AWS_REGION` | e.g. `ap-southeast-2` | The region you chose in AWS |
| `ECR_REPOSITORY` | `memolink-backend` | Part 1.2 - ECR repo name |
| `LAMBDA_FUNCTION_NAME` | `memolink-api` | Part 1.4 - Lambda function name |

---

## Part 4 - First Deployment

Push to `main` to trigger both pipelines:

```bash
git push origin main
```

Go to **GitHub → Actions** to watch progress:

- `Deploy Backend to AWS Lambda` - builds Docker image, pushes to ECR, updates Lambda (~3-5 min)
- `Azure Static Web Apps CI/CD` - Azure-generated workflow builds and deploys the frontend (~2 min)

---

## Part 5 - Verify

### Backend health check
```
GET https://xxxxxxxxxx.execute-api.ap-southeast-2.amazonaws.com/api/health
```
Expected:
```json
{ "status": "ok", "service": "MemoLink API" }
```

### Frontend
Open your Azure URL - you should see the MemoLink login page.

---

## Known Limitations on Lambda

| Feature | Behaviour |
|---|---|
| AI chat streaming | Buffered - full answer appears at once after generation completes |
| Research Mode | Works but may be slow on complex queries (120s timeout) |
| All other features | Work normally |

Chat streaming is buffered because API Gateway does not support Server-Sent Events.
The answer content is still complete and correct - it just appears all at once.

---

## Secrets Quick Reference

```
# GitHub Actions secrets (repo → Settings → Secrets → Actions)
# Azure adds its own token automatically - you only add the AWS ones below.

AWS_ACCESS_KEY_ID          IAM user access key        (Part 1.1)
AWS_SECRET_ACCESS_KEY      IAM user secret key        (Part 1.1)
AWS_REGION                 e.g. ap-southeast-2
ECR_REPOSITORY             memolink-backend           (Part 1.2)
LAMBDA_FUNCTION_NAME       memolink-api               (Part 1.4)

# Azure application setting (Azure portal → Static Web App → Configuration)

VITE_API_BASE_URL          API Gateway Invoke URL     (Part 1.6)

# Lambda environment variables (AWS console → Lambda → Configuration → Environment variables)

DATABASE_URL               OPENAI_API_KEY             OPENAI_CHAT_MODEL
OPENAI_EMBEDDING_MODEL     GEMINI_API_KEY             DEEPSEEK_API_KEY
BRAVE_SEARCH_API_KEY       SEMANTIC_SCHOLAR_API_KEY   JWT_SECRET_KEY
JWT_ALGORITHM              SMTP_HOST                  SMTP_PORT
SMTP_USER                  SMTP_PASSWORD              SMTP_FROM
FRONTEND_URL
```
