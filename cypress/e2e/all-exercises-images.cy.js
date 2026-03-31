/* global cy, describe, it, expect */

describe('Catalog view - exercise images', () => {
    it('opens catalog and verifies all exercises with images have reachable image URLs', () => {
        cy.visit('/')
        cy.get('[data-cy="menu-view"]').should('be.visible')
        cy.get('[data-cy="nav-catalog"]').click()
        cy.get('[data-cy="catalog-view"]').should('be.visible')

        cy.get('[data-cy="catalog-view"] table tbody tr').then((rows) => {
            const checks = []

            rows.each((_, row) => {
                const anchor = row.querySelector('td:nth-child(2) a')
                if (anchor) {
                    checks.push(anchor.href)
                }
            })

            expect(checks.length).to.be.greaterThan(0)

            checks.forEach((imageUrl) => {
                cy.request({ url: imageUrl, failOnStatusCode: false }).then((response) => {
                    expect(response.status, `Image status for ${imageUrl}`).to.eq(200)
                    expect(
                        response.headers['content-type'],
                        `Content-Type for ${imageUrl}`
                    ).to.match(/^image\//)
                })
            })
        })
    })
})
