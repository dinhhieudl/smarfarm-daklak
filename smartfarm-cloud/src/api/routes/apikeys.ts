// ============================================================================
// SmartFarm Cloud - API Routes: API Key Management
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate, requireScope } from '../middleware/auth';
import { createApiKeySchema } from '../../utils/validation';
import * as authService from '../../services/auth';

const router = Router();
router.use(authenticate);

// POST /api/v1/apikeys - Create a new API key
router.post('/', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = createApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    const { name, scopes, garden_id, expires_in_days } = parsed.data;

    const { apiKey, fullKey } = await authService.createApiKey(
      req.tenantId!,
      name,
      scopes,
      garden_id,
      expires_in_days
    );

    // Return the full key ONLY on creation (never shown again)
    res.status(201).json({
      id: apiKey.id,
      name: apiKey.name,
      key_prefix: apiKey.key_prefix,
      scopes: apiKey.scopes,
      garden_id: apiKey.garden_id,
      expires_at: apiKey.expires_at,
      created_at: apiKey.created_at,
      api_key: fullKey,  // <-- Only time this is returned
      warning: 'Store this key securely. It will not be shown again.',
    });
  } catch (err) {
    throw err;
  }
});

// GET /api/v1/apikeys - List API keys (sanitized, no hashes)
router.get('/', async (req: Request, res: Response) => {
  const keys = await authService.listApiKeys(req.tenantId!);
  res.json({ data: keys, count: keys.length });
});

// DELETE /api/v1/apikeys/:id - Revoke an API key
router.delete('/:id', requireScope('admin'), async (req: Request, res: Response) => {
  const success = await authService.revokeApiKey(req.params.id, req.tenantId!);
  if (!success) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ status: 'revoked' });
});

export default router;
