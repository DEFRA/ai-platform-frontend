/**
 * Extracts a cookie value (e.g. 'crumb' or session cookie) from a server.inject response.
 */
export function extractCookie(response, name) {
  const setCookie = response.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const match = cookies.find((cookie) => cookie?.startsWith(`${name}=`))

  return match?.split(';')[0].split('=').slice(1).join('=')
}
