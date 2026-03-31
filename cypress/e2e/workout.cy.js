/* global cy, describe, it */

describe('Workout app', () => {
    it('loads workouts and runs a step timer', () => {
        cy.clock(0, ['setInterval', 'clearInterval', 'Date'])
        cy.visit('/')

        cy.get('[data-cy="menu-view"]').should('be.visible')
        cy.get('[data-cy^="workout-"]').its('length').should('be.gte', 2)

        cy.get('[data-cy="workout-warm-up"]').click()
        cy.get('[data-cy="workout-view"]').should('be.visible')
        cy.get('[data-cy="current-step-name"]').should('contain.text', 'Wrists warm up')
        cy.get('[data-cy="timer"]').should('have.text', '00:20')

        cy.get('[data-cy="start-pause"]').click()
        cy.tick(3000)
        cy.get('[data-cy="timer"]').should('have.text', '00:17')

        cy.get('[data-cy="next-step"]').click()
        cy.get('[data-cy="current-step-name"]').should('contain.text', 'Shoulder roll')
        cy.get('[data-cy="timer"]').should('have.text', '00:15')

        cy.get('[data-cy="prev-step"]').click()
        cy.get('[data-cy="current-step-name"]').should('contain.text', 'Wrists warm up')

        cy.get('[data-cy="back-to-menu"]').click()
        cy.get('[data-cy="menu-view"]').should('be.visible')
    })
})
