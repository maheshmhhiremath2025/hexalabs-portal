/**
 * B2B Courses API routes
 *
 * Kept in a separate file so we don't touch the existing apiRoutes.jsx.
 */

export const b2bCourseApiRoutes = {
  analyze: '/b2b/courses/analyze',                          // POST multipart
  list: '/b2b/courses',                                     // GET
  get: (id) => `/b2b/courses/${id}`,                        // GET
  override: (id) => `/b2b/courses/${id}/override`,          // PATCH
  generateTemplate: (id) => `/b2b/courses/${id}/generate-template`, // POST
  delete: (id) => `/b2b/courses/${id}`,                     // DELETE
};
