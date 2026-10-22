import { apiClient } from '#/server/common/helpers/api-client.js'
import {
  canTry,
  isCapacityDuplicate
} from '#/server/routes/models/model-availability.js'

/**
 * The models a person can try on their own: the ones the backend says are
 * research available (offered to research and deployed there), never a
 * capacity duplicate.
 * @param {import('@hapi/hapi').Request} request
 * @returns {Promise<object[]>}
 */
export async function listTryableModels(request) {
  const { items } = await apiClient(request).get('/v1/models')

  return items.filter((model) => !isCapacityDuplicate(model) && canTry(model))
}

/**
 * One model a person can try on their own, or undefined when there is no such
 * model or it cannot be tried.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} slug
 * @returns {Promise<object | undefined>}
 */
export async function findTryableModel(request, slug) {
  const models = await listTryableModels(request)

  return models.find((model) => model.slug === slug)
}
