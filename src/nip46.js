/**
 * NIP-46 Remote Signer Service
 *
 * Implements the NIP-46 remote signing protocol over the app's HTTP shim.
 * For signing, Noas can only unlock keys for accounts that have a stored raw
 * password from signup.
 */

import { nip44, getPublicKey, generateSecretKey, finalizeEvent } from 'nostr-tools';
import { decrypt } from 'nostr-tools/nip49';
import { getActiveNostrUserById, getActiveNostrUserByUsername } from './db/users.js';
import { config } from './config.js';
import {
  createNip46Session,
  getNip46Session,
  updateNip46SessionStatus,
  createNip46Request,
  completeNip46Request,
  isMethodAllowed,
  getSessionByClientPubkey
} from './db/nip46.js';

function resolveSignerSecretKey() {
  if (config.nip46SignerPrivateKey) {
    return Uint8Array.from(Buffer.from(config.nip46SignerPrivateKey, 'hex'));
  }
  return generateSecretKey();
}

const signerSecretKey = resolveSignerSecretKey();
const signerPubkey = getPublicKey(signerSecretKey);

export { signerPubkey };

/**
 * Generate a random session/request ID
 * @returns {string} Random hex string
 */
function generateRandomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Encrypt content using NIP-44
 * @param {string} content - Content to encrypt
 * @param {string} senderSecretKey - Sender's secret key (hex)
 * @param {string} recipientPubkey - Recipient's public key (hex)
 * @returns {string} Encrypted content
 */
function encryptContent(content, senderSecretKey, recipientPubkey) {
  return nip44.encrypt(content, nip44.getConversationKey(senderSecretKey, recipientPubkey));
}

/**
 * Decrypt content using NIP-44
 * @param {string} encryptedContent - Encrypted content
 * @param {string} receiverSecretKey - Receiver's secret key (hex)
 * @param {string} senderPubkey - Sender's public key (hex)
 * @returns {string} Decrypted content
 */
function decryptContent(encryptedContent, receiverSecretKey, senderPubkey) {
  return nip44.decrypt(encryptedContent, nip44.getConversationKey(receiverSecretKey, senderPubkey));
}

/**
 * Create a connection token for client-initiated connections
 * @param {string} domain - Domain name for this signer
 * @returns {string} Connection token (bunker://) URL
 */
export function createConnectionToken(domain) {
  const relays = config.nip46Relays.length ? config.nip46Relays : ['wss://relay.nostr.org'];
  const query = new URLSearchParams({ secret: generateRandomId() });
  for (const relay of relays) {
    query.append('relay', relay);
  }
  return `bunker://${signerPubkey}?${query.toString()}`;
}

/**
 * Handle a NIP-46 connection request
 * @param {Object} requestData - Decrypted request data
 * @param {string} clientPubkey - Client's public key
 * @param {string} username - Username to connect to
 * @returns {Promise<Object>} Response object
 */
export async function handleConnect(requestData, clientPubkey, username) {
  const { id, params } = requestData;
  const [remoteSigner, secret, requestedPerms] = params || [];

  try {
    // Validate the remote signer pubkey matches ours
    if (remoteSigner && remoteSigner !== signerPubkey) {
      return {
        id,
        result: null,
        error: 'Invalid remote signer pubkey'
      };
    }

    // Get user by username
    const user = await getActiveNostrUserByUsername(String(username || '').trim().toLowerCase());
    if (!user) {
      return {
        id,
        result: null,
        error: 'User not found'
      };
    }

    // Parse requested permissions
    const permissions = requestedPerms ? requestedPerms.split(',') : ['*'];

    // Create session
    const sessionId = generateRandomId();
    const session = await createNip46Session({
      sessionId,
      userId: user.id,
      clientPubkey,
      remoteSigner: signerPubkey,
      secret,
      permissions
    });

    // Update session to connected
    await updateNip46SessionStatus(sessionId, 'connected');

    return {
      id,
      result: 'ack',
      error: null
    };

  } catch (error) {
    console.error('Connect error:', error);
    return {
      id,
      result: null,
      error: 'Connection failed'
    };
  }
}

/**
 * Handle a sign_event request
 * @param {Object} requestData - Decrypted request data
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Response object
 */
export async function handleSignEvent(requestData, sessionId) {
  const { id, params } = requestData;

  try {
    if (!await isMethodAllowed(sessionId, 'sign_event')) {
      return {
        id,
        result: null,
        error: 'Method not allowed'
      };
    }

    const [eventJson] = params || [];
    if (!eventJson) {
      return {
        id,
        result: null,
        error: 'Event data required'
      };
    }

    const event = JSON.parse(eventJson);
    
    const session = await getNip46Session(sessionId);
    if (!session || session.status !== 'connected') {
      return {
        id,
        result: null,
        error: 'Invalid session'
      };
    }

    const user = await getActiveNostrUserById(session.user_id);
    if (!user?.public_key || !user.private_key_encrypted || !user.raw_password) {
      return {
        id,
        result: null,
        error: 'Remote signing is unavailable for this account'
      };
    }

    let secretKey;
    try {
      secretKey = decrypt(user.private_key_encrypted, user.raw_password);
    } catch {
      return {
        id,
        result: null,
        error: 'Stored account key cannot be unlocked for remote signing'
      };
    }

    const derivedPubkey = getPublicKey(secretKey).toLowerCase();
    if (derivedPubkey !== String(user.public_key).trim().toLowerCase()) {
      return {
        id,
        result: null,
        error: 'Stored account key does not match the active public key'
      };
    }

    const signedEvent = finalizeEvent({
      ...event,
      pubkey: derivedPubkey,
    }, secretKey);

    return {
      id,
      result: JSON.stringify(signedEvent),
      error: null
    };

  } catch (error) {
    console.error('Sign event error:', error);
    return {
      id,
      result: null,
      error: 'Signing failed'
    };
  }
}

/**
 * Handle a get_public_key request
 * @param {Object} requestData - Decrypted request data
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Response object
 */
export async function handleGetPublicKey(requestData, sessionId) {
  const { id } = requestData;

  try {
    if (!await isMethodAllowed(sessionId, 'get_public_key')) {
      return {
        id,
        result: null,
        error: 'Method not allowed'
      };
    }

    const session = await getNip46Session(sessionId);
    if (!session || session.status !== 'connected') {
      return {
        id,
        result: null,
        error: 'Invalid session'
      };
    }

    const user = await getActiveNostrUserById(session.user_id);
    if (!user?.public_key) {
      return {
        id,
        result: null,
        error: 'User not found'
      };
    }

    return {
      id,
      result: user.public_key,
      error: null
    };

  } catch (error) {
    console.error('Get public key error:', error);
    return {
      id,
      result: null,
      error: 'Failed to get public key'
    };
  }
}

/**
 * Handle a ping request
 * @param {Object} requestData - Decrypted request data
 * @returns {Object} Response object
 */
export function handlePing(requestData) {
  const { id } = requestData;
  return {
    id,
    result: 'pong',
    error: null
  };
}

/**
 * Process a NIP-46 request
 * @param {Object} event - Nostr event containing the request
 * @param {string} username - Username for connection context
 * @returns {Promise<Object|null>} Response object or null if invalid
 */
export async function processNip46Request(event, username) {
  try {
    if (!event || event.kind !== 24133 || !Array.isArray(event.tags)) {
      return null;
    }
    const targetTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === 'p');
    if (!targetTag || targetTag[1] !== signerPubkey) {
      return null;
    }

    // Decrypt the request content
    const decryptedContent = decryptContent(event.content, signerSecretKey, event.pubkey);
    const requestData = JSON.parse(decryptedContent);

    const { method, id } = requestData;
    let response;
    let session = await getSessionByClientPubkey(event.pubkey);
    let sessionId = session?.session_id;

    switch (method) {
      case 'connect':
        response = await handleConnect(requestData, event.pubkey, username);
        session = await getSessionByClientPubkey(event.pubkey);
        sessionId = session?.session_id;
        break;
      
      case 'ping':
        response = handlePing(requestData);
        break;
      
      case 'get_public_key':
        if (!sessionId) {
          response = { id, result: null, error: 'No session found' };
          break;
        }
        response = await handleGetPublicKey(requestData, sessionId);
        break;
      
      case 'sign_event':
        if (!sessionId) {
          response = { id, result: null, error: 'No session found' };
          break;
        }
        response = await handleSignEvent(requestData, sessionId);
        break;
      
      default:
        response = {
          id,
          result: null,
          error: `Unknown method: ${method}`
        };
    }

    // Store the request and response for audit trail
    if (sessionId) {
      await createNip46Request({
        requestId: id,
        sessionId,
        method,
        params: requestData.params
      });
      
      await completeNip46Request(id, response.result, response.error);
    }

    return response;

  } catch (error) {
    console.error('Process NIP-46 request error:', error);
    return null;
  }
}

/**
 * Create a NIP-46 response event
 * @param {Object} response - Response data  
 * @param {string} clientPubkey - Client's public key to send response to
 * @returns {Object} Nostr event object
 */
export function createResponseEvent(response, clientPubkey) {
  const content = encryptContent(JSON.stringify(response), signerSecretKey, clientPubkey);
  
  const event = {
    kind: 24133,
    pubkey: signerPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', clientPubkey]],
    content
  };

  // Sign the event
  return finalizeEvent(event, signerSecretKey);
}
